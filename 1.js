"use strict";

const loginInfo = {
	mail_tel: " your mailaddress here ",
	password: " your password here ",
};

const cheerio = require("cheerio");
const request = require("request-promise-native");
const {spawn} = require("child_process");

void async function main() {
	// Cookieを処理するためのJarを用意する
	const jar = request.jar();

	// request設定
	const {get, post} = request.defaults({jar, followAllRedirects: true});

	// ログインする
	const loginResponse = await post("https://account.nicovideo.jp/api/v1/login").form(loginInfo);
	if(/メールアドレスまたはパスワードが間違っています/.test(loginResponse)){
		return console.error("ログインに失敗しました");
	}

	// 動画ファイルのURLを抜き出す
	const apiData = cheerio.load(await get("http://www.nicovideo.jp/watch/sm10780722"))("#js-initial-watch-data").data("api-data");
	const videoURL = apiData.video.smileInfo.url;

	// 動画ファイルの取得に必要なCookieを抜き出す
	const cookies = jar.getCookieString(videoURL);

	// FFMPEGに動画をDLさせる
	spawn("ffmpeg", [
		"-y", // 出力ファイルの上書きを許可
		"-headers", `Cookie: ${cookies}`, // HTTPで動画を取りに行くときにCookieを使ってもらう
		"-i", videoURL, // HTTPで動画を拾ってきてもらう
		"-c:v", "copy", // 動画を変換しない
		"-c:a", "copy", // 音声を変換しない
		"workdir/video.mp4", // ファイル出力先
	], {
		stdio: "inherit",
	});
}();
