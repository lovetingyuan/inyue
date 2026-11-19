# inYue

inYue 是一款个人音乐应用，可以管理自己的曲库、创建歌单和播放音乐。

- **跨平台**：支持 Web 和 Android App。
- **离线访问**：断网时也能打开离线曲库，播放已保存的歌曲。

[访问官网](https://inyue.tingyuan.nz)

## Android 安装包

- `npm run build:android` 生成可独立安装的 `android/app/build/outputs/apk/debug/app-debug.apk`，连接正式环境。
- `npm run android` 将热重载版安装到已连接的设备，产物在 `temp/android-live-reload/outputs/apk/debug/`，启动时需要电脑上的 Nuxt 开发服务。
