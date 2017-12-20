"use strict";

const loginInfo = {
	mail_tel: " your mailaddress here ",
	password: " your password here ",
};

const cheerio = require("cheerio");
const request = require("request-promise-native");
const {spawn} = require("child_process");

const Koa = require("koa");
const route = require("koa-route");
const serve = require("koa-static");
const bodyParser = require("koa-bodyparser");

let client;
let playlists = {};

// 動画ファイルを取得・分割して、M3U8（のStream）を返す
const getVideo = async (videoID) => {
	if(!client){
		// Cookieを処理するためのJarを用意する
		const jar = request.jar();

		// request設定
		const {get, post} = request.defaults({jar, followAllRedirects: true});

		// ログインする
		const loginResponse = await post("https://account.nicovideo.jp/api/v1/login").form(loginInfo);
		if(/メールアドレスまたはパスワードが間違っています/.test(loginResponse)){
			throw new Error("ログインに失敗しました");
		}

		client = async (videoID) => {
			// 動画ファイルのURLを抜き出す
			const apiData = cheerio.load(await get(`http://www.nicovideo.jp/watch/${videoID}`))("#js-initial-watch-data").data("api-data");
			const videoURL = apiData.video.smileInfo.url;

			// 動画ファイルの取得に必要なCookieを抜き出す
			const cookies = jar.getCookieString(videoURL);

			// FFMPEGに動画をDLさせ、分割してM3U8プレイリストを作成する
			const ffmpeg = spawn("ffmpeg", [
				"-y", // 出力ファイルの上書きを許可
				"-headers", `Cookie: ${cookies}`, // HTTPで動画を取りに行くときにCookieを使ってもらう
				"-i", videoURL, // HTTPで動画を拾ってきてもらう
				"-c:v", "copy", // 動画を変換しない
				"-c:a", "copy", // 音声を変換しない
				"-hls_time", "15", // だいたい15秒ごとに分割
				"-hls_list_size", "0", // リストに含めるファイルの最大数（0で制限なし）
				"-hls_segment_filename", `workdir/${videoID}_%d.ts`, // 分割したファイルの名前（%dに連番が入る）
				"pipe:1.m3u8", // M3U8プレイリストを標準出力へ流す
			], {
				// FFMPEGの標準出力をNodeJSのストリームとして受け取る
				stdio: ["ignore", "pipe", process.stderr],
			});

			// FFMPEGの標準出力ストリーム（M3U8が流れてくる）を返す
			return ffmpeg.stdout;
		};
	}
	return client(videoID);
};

// トップページを返す
const GET_index = async (ctx) => {
	ctx.body = `
		<form method="POST" action="/play">
			<label>
				動画ID:
				<input type="text" name="videoID" placeholder="sm*******">
			</label>
			<input type="submit">
		</form>
	`;
};

// m3u8プレイリストを返す
const GET_playlist = async (ctx, vid) => {
	ctx.type = "audio/mpegurl";
	ctx.body = playlists[vid];
};

// 再生ページを返す
const POST_play = async (ctx) => {
	const vid = ctx.request.body.videoID;

	// 再生用のHTMLを返す
	ctx.body = `
		<video autoplay controls src="/${vid}.m3u8" style="width:100%">
		</video>
	`;

	// videoを取得してプレイリストを更新
	const m3u8stream = await getVideo(vid);
	m3u8stream.on("data", (data) => {
		// FFMPEGは、エンコードが進行するたびに新しいm3u8を頭から送ってくる
		playlists[vid] = data.toString();
	});

	// エンコードが終了するまで待つ
	return new Promise((resolve) => m3u8stream.on("end", resolve));
};

void async function main() {
	const app = new Koa();

	// workdir以下に生成されるTSファイルを配信する
	app.use(serve("./workdir"));

	// トップページ
	app.use(route.get("/", GET_index));

	// プレイリストの配信
	app.use(route.get("/:videoID.m3u8", GET_playlist));

	// 動画再生リクエストを受ける
	app.use(bodyParser());
	app.use(route.post("/play", POST_play));

	app.listen(3000);
}();
