export function medicationMutationErrorMessage(error) {
  if (Number(error?.status) === 403 || error?.code === "FORBIDDEN") {
    return "目前帳號只有查看權限，這次沒有記錄成功。";
  }
  return error?.message || "無法記錄吃藥狀態，請再試一次。";
}
