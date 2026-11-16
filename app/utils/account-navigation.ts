export function libraryReturnPath(redirect: unknown) {
  return redirect === "/songs/new" ? redirect : undefined;
}

export function googleLoginError(code: unknown) {
  if (code === "access_denied") return "";
  if (code === "EMAIL_NOT_VERIFIED" || code === "email_not_verified")
    return "请先验证邮箱，再使用 Google 登录。";
  return "Google 登录失败，请重试。";
}
