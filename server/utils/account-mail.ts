import { useRuntimeConfig } from "nitropack/runtime";
import { createError } from "h3";
const accountMailCopy = {
  验证邮箱: "你好，欢迎加入 inYue！请验证你的邮箱以完成注册。",
  重置密码: "你好，请点击下方按钮重置你的 inYue 密码。",
};

const logoUrl = "https://inyue.tingyuan.nz/assets/imgs/logo.png";
const brandGreen = "#21654f";

export function hasAccountMail(config: ReturnType<typeof useRuntimeConfig>) {
  return Boolean(config.resendApiKey && config.mailFrom) || localPreview(config);
}

function localPreview(config: ReturnType<typeof useRuntimeConfig>) {
  return (
    config.mailPreview && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.public.siteUrl)
  );
}

export async function sendAccountMail(
  to: string,
  subject: keyof typeof accountMailCopy,
  url: string,
) {
  const config = useRuntimeConfig();
  if (!config.resendApiKey || !config.mailFrom) {
    if (localPreview(config)) {
      console.info(`[本地邮件预览] ${subject} ${url}`);
      return;
    }
    throw createError({ statusCode: 503, statusMessage: "Account email is not configured" });
  }

  const message = accountMailCopy[subject];
  const notice = "如果这不是你发起的请求，可以忽略此邮件。";
  const safeUrl = url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const text = `${message}\n\n${subject}：${url}\n\n${notice}`;
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${subject}</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .email-body { background-color: #202723 !important; }
      .email-card { background-color: #191e1b !important; color: #eef2eb !important; }
      .email-link { color: #a8e1c5 !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;background-color:#f1efe8">
  <div style="max-width:520px;margin:0 auto;padding:24px 12px">
    <div class="email-card" style="background-color:#fbfaf7;color:#202923;padding:24px;border-radius:16px;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
      <img src="${logoUrl}" alt="inYue" width="56" height="56" style="display:block">
      <h1 style="margin:16px 0 8px;font-size:24px">${subject}</h1>
      <p style="margin:0 0 20px">${message}</p>
      <a href="${safeUrl}" style="display:inline-block;padding:10px 20px;border-radius:8px;background-color:${brandGreen};color:#fff;text-decoration:none;font-weight:bold">${subject}</a>
      <p style="margin:20px 0 12px;font-size:14px">
        如果按钮无法打开，请复制以下链接到浏览器。<br>
        <a class="email-link" href="${safeUrl}" style="color:${brandGreen};overflow-wrap:anywhere;word-break:break-all">${safeUrl}</a>
      </p>
      <p style="margin:0;font-size:14px">${notice}</p>
    </div>
  </div>
</body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, html }),
  });
  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: "Account email delivery failed" });
  }
}
