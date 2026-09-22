# Kế hoạch nâng cấp MIAAssistant

> **Scope:** Assistant Web, Agent API, contracts/adapters, knowledge và Admin Portal.
>
> **Kiến trúc toàn hệ thống:** [`mia/docs/Arch.md`](../../mia/docs/Arch.md)
>
> **Versioning:** [contracts-versioning.md](./contracts-versioning.md)

## 1. Ownership và ranh giới

MIAAssistant sở hữu:

- `@mia/contracts`, Web adapter và React Native adapter;
- Assistant Web chạy trong iframe/WebView;
- Agent API, Router, Agent Điều hướng/Tỷ giá/Tư vấn và SSE response;
- knowledge ingestion, mapping/retrieval/citation, Admin Portal và Agent audit;
- compatibility matrix, package/image release và integration documentation.

MIAAssistant không sở hữu banking transaction API và không được submit, sửa, hủy hoặc retry giao dịch. Context từ Host là read-only, phải validate lại ở backend.

## 2. Baseline đã có

- [x] Repo/deployment độc lập với Assistant Web và Agent API.
- [x] Contracts `0.1.x`, wire `1.0`, JSON Schemas và test vectors.
- [x] Web context adapter và React Native bridge packages.
- [x] Chat API bắt buộc nhận `ContextSnapshot`; không có Host transaction mutation.
- [x] Advisory prototype dùng knowledge seed và citation cơ bản.
- [x] Package artifacts, Docker/Compose, compatibility/versioning/deployment docs.

Baseline cần được bảo vệ bằng regression tests trước mỗi lần bump package/image.

## 3. Backlog thực thi

### M1 — Contracts và release pipeline

- [ ] Nghiệm thu contracts/data/action/state/voice/navigation extension 1.1 và packages 0.2.0; context wire 1.0 giữ nguyên.
- [ ] Chạy chung scenario data vectors TS/Python và kiểm tra producer/consumer pin artifacts.

- [ ] Khóa allowlist, redaction, TTL, error selection và replay semantics trong schema/tài liệu.
- [ ] Bổ sung vectors hợp lệ/không hợp lệ cho Web, Mobile và Python validator.
- [ ] Chuẩn hóa error envelope khi contract mismatch/stale/inconsistent snapshot.
- [ ] Tự động kiểm tra semver và compatibility matrix trong CI.
- [ ] Publish contracts → adapters theo thứ tự; tạo tarball/checksum/SBOM và release notes.
- [ ] Loại bỏ nhu cầu copy schema/source vào consumer; tài liệu hóa migration minor/major.

**Exit:** Hai Host chạy cùng vectors và dependency version khớp compatibility matrix.

### M2 — Adapter hardening

- [ ] Nghiệm thu handler Web/RN chuyên biệt, handshake, session/freshness/replay, lifecycle và navigation acknowledgement.

- [ ] Web: exact origin/source/session, replay window, unknown message và URL injection tests.
- [ ] Web: last-known-good config reload, selector safety, redacted telemetry và emergency disable.
- [ ] RN: exact origin/navigation policy, handshake/timeout/retry và app lifecycle/session rotation.
- [ ] Giữ API `capture`, `reportPresentedError`, `resolveError` nhất quán giữa integration guides.
- [ ] Cross-origin iframe và WebView integration fixtures dùng package build thật.

**Exit:** Host chỉ cần bootstrap/provider một lần; bridge negative tests đạt trên Web/Mobile.

### M3 — Assistant Web và conversation runtime

- [ ] Nghiệm thu kịch bản Home/chức năng, template address/pronoun, timing 1s/2s và hàng đợi có thể hủy.
- [ ] Nghiệm thu Idle/Listening/Thinking/Working/Done, Done 1s, nhãn accessibility và voice fallback.

- [ ] Hoàn thiện bubble/panel responsive cho iframe và WebView; loading, retry, offline và error states.
- [ ] Parse SSE theo `requestId`; stream kết thúc đúng một `final` hoặc `error`.
- [ ] Render card FX, error summary, steps, suggestions và citations.
- [ ] Voice `vi-VN`: chỉ đọc `speechText` cuối; microphone/synthesis lỗi chuyển text fallback.
- [ ] Hỗ trợ “giải thích đơn giản hơn”, “nói kỹ hơn”, “nhắc lại” mà không mất facts/citations.
- [ ] Accessibility cho keyboard/focus/screen reader và mobile text scaling.

**Exit:** Một Assistant UI dùng được từ cả iframe Web và Mobile WebView với response contract thống nhất.

### M4 — Router và Agent capabilities

- [ ] Nghiệm thu todo groups theo priority/x, offering eligible còn hiệu lực, Home hỏi hướng dẫn và action định danh.
- [ ] Nghiệm thu đề xuất điều hướng, xác nhận/hủy hai phương thức nhập và context đổi hủy đề xuất.

- [ ] Router chọn đúng một Agent chính; intent mơ hồ hỏi lại một câu ngắn.
- [ ] Agent Điều hướng chỉ tạo `navigate_to(routeId)` allowlist và chờ Host confirmation.
- [ ] Agent Tỷ giá chỉ dùng synthetic FX store, hỗ trợ các cặp đã cấu hình và luôn có disclaimer.
- [ ] Agent Tư vấn ưu tiên snapshot/error đã validate hơn mô tả tự do.
- [ ] Tool registry customer-facing chỉ chứa read tools và navigation request; không chứa Host mutation/Admin tools.
- [ ] Timeout/tool/MaaS failure giữ conversation và cho retry bằng text.

**Exit:** Intent suite tiếng Việt đạt mục tiêu; route lạ và unsupported FX pair bị từ chối có audit.

### M5 — Grounded advisory và retrieval

- [ ] Nghiệm thu guides published và error advisory/clarify có lịch sử cùng lỗi; không đưa recipient vào model prompt hoặc ContextSnapshot.

- [ ] Thực hiện pipeline: exact `operation + errorCode` → filtered hybrid retrieval → rerank → chunks → grounded response.
- [ ] Chỉ truy xuất active dataset `published`; không để draft/archived lọt vào Agent.
- [ ] Mỗi bước hướng dẫn có citation về source/version/page/section/chunk.
- [ ] Khi không có căn cứ, nói rõ chưa có hướng dẫn và dùng escalation đã cấu hình; không tạo quy trình mới.
- [ ] Bổ sung groundedness, citation completeness, prompt-injection và sensitive-data evaluation.
- [ ] Audit context/intent/tool/source/version/latency ở dạng đã redact.

**Exit:** Không có bước nghiệp vụ ngoài nguồn trong eval set; 100% bước hướng dẫn có citation hợp lệ.

### M6 — Agent Admin Portal và knowledge lifecycle

- [ ] Upload YAML/CSV/XLSX mapping và PDF/DOCX/Markdown/TXT guides với size/MIME/checksum/schema validation.
- [ ] Parse headings/pages/tables; chunk và giữ provenance/citation.
- [ ] AI chỉ gợi ý extraction/metadata; bắt buộc human preview trước publish.
- [ ] Cho sửa metadata/loại chunk, tạo draft, atomic publish và rollback published version.
- [ ] Publish/index lỗi giữ active version gần nhất; original source bất biến theo checksum.
- [ ] Tách Admin auth/tool surface khỏi customer Agent; audit mọi publish/rollback.

**Exit:** Upload → preview → draft → publish → retrieve → rollback chạy end-to-end và failure-safe.

### M7 — Context Gateway và production hardening

- [ ] Thiết kế gateway đổi snapshot thành opaque token TTL ngắn, bound với session/origin và chống replay.
- [ ] Giữ direct snapshot cho MVP nhưng không đổi Host bridge khi chuyển sang token.
- [ ] CORS/CSP/frame policy exact origins; rate limit, request size, timeout và resource limits.
- [ ] Health/readiness kiểm tra config, active dataset, index và model dependency.
- [ ] Production secrets chỉ ở backend; log/prompt/audit đều redact.

**Exit:** Gateway có thể bật theo config và fallback/rollback không yêu cầu release lại Host.

### M8 — E2E, CI và deployment

- [ ] Chạy E2E Web/Android/iOS cho cá nhân hóa, timing, dữ liệu lỗi/rỗng, model/voice failure, navigation và rollback extension.

- [ ] Contract/unit/API tests cho TS/Python cùng vectors.
- [ ] Cross-origin Playwright với DemoMSBWeb; device smoke với DemoMSBApp.
- [ ] Test stale/replay/wrong origin, prompt injection, Assistant down, knowledge publish failure và model timeout.
- [ ] Build image `linux/amd64`, package artifacts và integration compose pin version.
- [ ] Cập nhật deployment, compatibility, rollback runbook và release evidence.

**Exit:** Ba-project integration suite đạt với version pin và từng artifact rollback độc lập.

## 4. Contract với project khác

### Với DemoMSBWeb

- Phát hành contracts/Web adapter; nhận snapshot và navigation confirmation.
- Không gọi banking mutation; Host vẫn sở hữu route thật và error lifecycle.

### Với DemoMSBApp

- Phát hành contracts/RN adapter và Assistant WebView-compatible UI.
- Không yêu cầu generic native bridge hoặc quyền đọc native state ngoài provider.

## 5. Nghiệm thu bắt buộc

1. Cùng snapshot cho Web/Mobile tạo cùng error mapping/citation về facts.
2. Snapshot stale/sai session-screen, replay và origin/source sai đều bị từ chối.
3. Agent Điều hướng không tự xác nhận trước `host.navigation.completed`.
4. Agent Tỷ giá luôn ghi rõ synthetic, không dùng cho giao dịch.
5. Draft knowledge không truy xuất được; publish lỗi không đổi active version.
6. Assistant/Agent không gọi endpoint transaction mutation.
7. Model/tool lỗi kết thúc stream hợp lệ và người dùng có text fallback/retry.

## 6. Sau parity

- Managed database/object/vector storage và IAM/RBAC production.
- Observability/SLO, autoscaling, disaster recovery và compliance controls.
- Native Kotlin/Swift adapters chỉ khi có consumer đã xác nhận.

## 7. Kịch bản MIA và cá nhân hóa — nghiệm thu tích hợp

Nguồn chuẩn: [mia-scenarios.md](mia-scenarios.md), [mia-configuration.md](mia-configuration.md), [lộ trình](../../mia/docs/mia-delivery-roadmap.md). Các checklist mới chờ nghiệm thu tích hợp, kể cả khi code/unit tests đã có.

- [ ] User Nam đọc anh + tên; Nữ đọc chị + tên; user chưa khai báo/không xác định đọc anh/chị không tên.
- [ ] Không trộn tên/hội thoại giữa phiên; reload áp dụng login mới; logout xóa dữ liệu cũ.
- [ ] Home chào/nhắc tối đa x loại (mặc định 2), tổng chỉ nhóm được đọc; offering sau câu trước 2s.
- [ ] Lời chào ẩn 1s sau đọc, bubble vẫn còn; mở lại không phát lại; context đổi hủy tác vụ cũ.
- [ ] Hướng dẫn/lỗi dùng nguồn published; làm rõ nhiều lượt không gửi recipient/form vào prompt.
- [ ] Nút/voice đều xác nhận; Done chỉ sau completed; lỗi/permission/service thất bại có text fallback.
