# Care WEDO Real Receipt Regression Pack

> 最後更新：2026-06-20
> 目標：建立 P0-003 真實台灣醫院單據回歸包，驗證 LINE WebView、OCR、照護對象歸屬、重複上傳與低信心人工確認流程。

## 1. 安全原則

- 不把真實醫療單據圖片 commit 到 Git。
- 真實圖檔只放在 `test-fixtures/real-receipt-regression/private-images/`，此目錄已加入 `.gitignore`。
- commit 只允許去識別化 manifest 與 expected shape：單據類型、場景標籤、預期欄位、私有檔案相對路徑、hash 或 hash placeholder。
- Manifest 不可放完整姓名、身分證、生日、完整病歷、完整藥名清單、醫療全文。
- `expected-shapes.json` 不可含 OCR 原文、圖片、病患識別資訊或完整醫療內容；只保存 record kind / type / required fields 與安全預期。

## 2. 目前資料包狀態

`test-fixtures/real-receipt-regression/manifest.json` 已定義 10 張測試單據位置與預期結果；`test-fixtures/real-receipt-regression/expected-shapes.json` 保存同一批案例的去識別化 expected shape：

| 類型 | 覆蓋 |
|---|---|
| 掛號 / 門診 | 2 張 |
| 檢查 / 檢驗 | 2 張 |
| 領藥提醒 | 2 張 |
| 藥袋 | 2 張 |
| 處方箋 | 2 張 |

Beta-critical scenarios：

- `multi_upload`：多張連續上傳不丟 session。
- `wrong_profile_then_reassign`：先選錯人後可重新歸屬。
- `duplicate_upload`：重複上傳時，長輩端不顯示錯誤或重複壓力。
- `low_confidence_review`：OCR 不確定時，家人端需要確認。

## 3. 放入真實去識別化圖片

1. 將去識別化後的 JPG/PNG 放到：

```text
test-fixtures/real-receipt-regression/private-images/
```

2. 檔名對齊 manifest：

```text
tw-clinic-visit-01.jpg
tw-clinic-visit-02.jpg
tw-inspection-01.jpg
tw-inspection-02.jpg
tw-refill-01.jpg
tw-refill-02.jpg
tw-medication-bag-01.jpg
tw-medication-bag-02.jpg
tw-prescription-01.jpg
tw-prescription-02.jpg
```

3. 先做 private-image dry-run：

```bash
npm run receipt-pack:private-check -- --dry-run
```

這只回報缺圖 / hash 狀態，不印出完整私有路徑或 sha256 值。

4. 私有圖片齊全後，寫入 manifest hash：

```bash
npm run receipt-pack:hashes
```

這會把每張私有圖的 `fixture.sha256` 寫回 `manifest.json`。圖片本身仍不可 commit。沒有私有圖片時，CI 仍只檢查 manifest / expected-shapes 結構，不假裝已完成實機 OCR。

## 4. 驗收指令

先檢查 manifest 結構：

```bash
npm run receipt-pack:check
```

檢查本機私有圖檔與 hash 狀態：

```bash
npm run receipt-pack:private-check
```

沒有私有圖片時這個嚴格檢查會失敗；只要看缺口請用：

```bash
npm run receipt-pack:private-check -- --dry-run
```

私有圖片與 hash 都到位後，再跑 OCR smoke dry-run：

```bash
npm run receipt-pack:smoke
```

重新產生去識別化 expected shape：

```bash
npm run receipt-pack:shapes
```

這會更新 `test-fixtures/real-receipt-regression/expected-shapes.json`。檔案只應出現 case id、文件類型、場景、預期 record kind/type/required_fields 與安全預期。

需要真的送到 OCR smoke endpoint 時，才明確啟用：

```bash
CARE_WEDO_REAL_RECEIPT_SMOKE_URL="https://care.wedopr.com/api/ocr/" \
CARE_WEDO_REAL_RECEIPT_ID_TOKEN="[REDACTED]" \
node scripts/real-receipt-smoke-runner.mjs --send
```

注意：`CARE_WEDO_REAL_RECEIPT_ID_TOKEN` 只放本機環境，不寫進文件、不 commit。

再跑完整回歸：

```bash
cd care-wedo-app
pnpm test
pnpm lint
pnpm build
```

## 5. 實機驗收流程

| 情境 | 驗收 |
|---|---|
| 10 張真實單據 | 至少覆蓋掛號、檢查、領藥、藥袋、處方箋 |
| 多張連續上傳 | LINE WebView 不丟 session、不歸錯人 |
| 先選錯人再改人 | 可重新選照護對象，資料歸屬修正 |
| 重複上傳 | 長輩端不提示「重複」或錯誤，家人端能辨識新增 / 更新 |
| 低信心 OCR | 家人端提示需要確認，不靜默進正式清單 |

## 6. 下一步

- 建立手動 LINE WebView 測試紀錄表。
- 補真實圖片 hash，不把圖片 commit；目前沒有本機私有圖片時，hash 仍會保留 `pending-private-image-hash`。
- 私有圖片齊全後，先跑 `receipt-pack:hashes` 寫入 hash，再跑 `receipt-pack:private-check` 與 `receipt-pack:smoke`；需要打 OCR endpoint 時才用 `--send`。
