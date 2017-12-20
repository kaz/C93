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

// 待機中の動画を読み込み
let waitCount = 0;
const waitVideo = require("fs").readFileSync("resources/waiting.m3u8", "ascii").match(/#EXTINF:.+\n.+\.ts/g);
waitVideo[0] = "#EXT-X-DISCONTINUITY\n" + waitVideo[0];

let client;
const playlist = {
	videoCount: 0,
	streamCount: 0,
	streams: [],
	m3u8: "",
};
const status = {
	processQueue: [],
	processing: "",
	playQueue: [],
	playing: "",
};

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
				"-hls_time", "5", // だいたい5秒ごとに分割
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
		<video id="vjs" class="video-js vjs-default-skin" controls style="width:100%">
			<source type="application/x-mpegURL" src="/playlist.m3u8">
		</video>
		<form method="POST" action="/play">
			<label>
				動画ID:
				<input type="text" name="videoID" placeholder="sm*******">
			</label>
			<input type="submit">
		</form>
		<div id="container">
			<div>
				<h3>m3u8</h3>
				<pre id="m3u8"></pre>
			</div>
			<div>
				<h3>再生中</h3>
				<pre id="playing"></pre>
			</div>
			<div>
				<h3>再生待ち</h3>
				<pre id="playQueue"></pre>
			</div>
			<div>
				<h3>処理中</h3>
				<pre id="processing"></pre>
			</div>
			<div>
				<h3>処理待ち</h3>
				<pre id="processQueue"></pre>
			</div>
		</div>
		<style>
			#container {
				display: flex;
			}
			#container > div {
				margin-right: 1em;
			}
		</style>
		<link href="https://cdnjs.cloudflare.com/ajax/libs/video.js/6.6.0/alt/video-js-cdn.min.css" rel="stylesheet">
		<script src="https://cdnjs.cloudflare.com/ajax/libs/video.js/6.6.0/video.min.js"></script>
		<script src="https://cdnjs.cloudflare.com/ajax/libs/videojs-contrib-hls/5.12.2/videojs-contrib-hls.min.js"></script>
		<script>(${clientSideJS})();</script>
	`;
};
const clientSideJS = (() => {
	const update = async (body) => {
		const resp = await fetch("/play", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body,
		});
		const data = await resp.json();
		document.querySelector("#m3u8").textContent = data.playlist.m3u8;
		document.querySelector("#playing").textContent = data.status.playing;
		document.querySelector("#playQueue").textContent = data.status.playQueue.join("\n");
		document.querySelector("#processing").textContent = data.status.processing;
		document.querySelector("#processQueue").textContent = data.status.processQueue.join("\n");
	};
	document.querySelector("form").onsubmit = () => {
		update(`videoID=${document.querySelector("[name='videoID']").value}`);
		return false;
	};
	setInterval(() => update(""), 1000);
	update("");

	const player = videojs("vjs");
	player.play();
}).toString();

// m3u8プレイリストを返す
const GET_playlist = async (ctx, vid) => {
	ctx.type = "audio/mpegurl";
	ctx.body = playlist.m3u8;
};

// キューに動画IDを追加
const POST_play = async (ctx) => {
	const vid = ctx.request.body.videoID;
	if(vid){
		status.processQueue.push(vid);
	}

	// 現在のステータスを返す
	ctx.status = 200;
	ctx.body = {status, playlist};
};

// ビデオの取得（別スレッド風）
const processVideoQueue = async () => {
	while(true){
		// キューから動画IDを取得
		const vid = status.processQueue.shift();
		if(vid){
			status.processing = vid;
			status.playQueue.push(vid);

			// videoを取得
			const m3u8stream = await getVideo(vid);

			// m3u8プレイリストを更新
			const added = {};
			m3u8stream.on("data", (data) => {
				data.toString().replace(/#EXTINF:.+\n(.+\.ts)/g, (entry, fileName) => {
					if(!added[fileName]){
						playlist.streams.push(`${Object.values(added).length ? "" : "#EXT-X-DISCONTINUITY\n"}${entry}`);
						added[fileName] = true;
					}
				});
			});

			// 処理が終わるまで待つ
			await new Promise((resolve) => m3u8stream.on("end", resolve));
			status.processing = "";
		}

		// １秒間待つ
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
};

// プレイリストの整理（別スレッド風）
const refreshPlaylist = async () => {
	while(true){
		// 先頭のTSを取り出して削除、状態をいろいろ書き換える
		const ts = playlist.streams.shift();
		if(ts){
			playlist.streamCount++;
			if(/#EXT-X-DISCONTINUITY/.test(ts)){
				playlist.videoCount++;
				status.playing = /waiting/.test(ts) ? "" : status.playQueue.shift()
			}
		}

		// 再生するTSがなかったら、待機画面を出す
		while(playlist.streams.length < 2){
			playlist.streams.push(waitVideo[waitCount].trim());
			if(++waitCount % waitVideo.length == 0){
				waitCount = 0;
			}
		}

		// 再生待ちTSから２コ取り出してm3u8にする
		const currentStream = playlist.streams.slice(0, 2);
		const durations = currentStream.map(s => {
			const m = s.match(/#EXTINF:(.+),/);
			return parseFloat(m[1]);
		});

		const headers = [
			"#EXTM3U",
			"#EXT-X-VERSION:3",
			`#EXT-X-TARGETDURATION:${Math.ceil(durations.reduce((a, b) => Math.max(a, b), 0))}`,
			`#EXT-X-MEDIA-SEQUENCE:${playlist.streamCount}`,
			`#EXT-X-DISCONTINUITY-SEQUENCE:${playlist.videoCount}`,
		];
		playlist.m3u8 = headers.concat(currentStream).join("\n");

		// 先頭のTSの長さだけ待機
		await new Promise((resolve) => setTimeout(resolve, 1000 * parseFloat(durations[0])));
	}
};

void async function main() {
	processVideoQueue();
	refreshPlaylist();

	const app = new Koa();

	// workdir以下に生成されるTSファイルを配信する
	app.use(serve("./workdir"));

	// resources以下にTSファイルを配信する
	app.use(serve("./resources"));

	// トップページ
	app.use(route.get("/", GET_index));

	// プレイリストの配信
	app.use(route.get("/playlist.m3u8", GET_playlist));

	// 動画再生リクエストを受ける
	app.use(bodyParser());
	app.use(route.post("/play", POST_play));

	app.listen(3000);
}();
