# Kế hoạch nâng cấp DemoMSBWeb

> **Scope:** Host Web và demo banking API dùng chung cho Web/Mobile.
>
> **Kiến trúc toàn hệ thống:** [`mia/docs/Arch.md`](../../mia/docs/Arch.md)
>
> **Tích hợp Assistant:** [integration-assistant.md](./integration-assistant.md)

## 1. Ownership và ranh giới

DemoMSBWeb sở hữu:

- React Host Web: login, dashboard, route và màn hình nghiệp vụ;
- demo banking API: session, context, transaction scenario và error record;
- Host-side integration của `@mia/web-context-adapter`;
- route allowlist, UI error lifecycle, CSP và cấu hình Assistant origin;
- unit/API/E2E test và Docker image của Host.

DemoMSBWeb không sở hữu Agent, Assistant UI, prompt, knowledge dataset hay source contract. Host không cho Agent gọi endpoint submit và vẫn phải sử dụng được khi MIAAssistant tắt.

## 2. Baseline đã có

- [x] Host Web login, dashboard và luồng giải ngân nội địa.
- [x] Banking API tạo session, lưu context và xử lý scenario deterministic.
- [x] Inline/popup errors và success response từ dữ liệu demo.
- [x] Iframe Assistant khác origin và Web adapter package `0.1.x`.
- [x] Artifact vendor để bootstrap offline, Docker image và API tests cơ bản.
- [x] ADR xác nhận DemoMSBWeb sở hữu banking API dùng chung cho DemoMSBApp.

Các checkbox trên mô tả baseline quan sát được sau đợt tách, không thay thế kiểm thử hồi quy ở mốc release.

## 3. Backlog thực thi

### W1 — Parity nghiệp vụ Host Web

- [ ] Hoàn thiện route allowlist `home`, `transfer`, `qr-payment`, `disbursement` và màn hình còn thiếu.
- [ ] Đảm bảo login tạo session riêng; reload/route change không trộn state giữa các session.
- [ ] Chuẩn hóa loading, success, inline error, popup error và retry UX.
- [ ] Gắn nhãn “Dữ liệu mô phỏng / Synthetic Demo Data” tại mọi màn hình nghiệp vụ.
- [ ] Bảo đảm form/transaction hoạt động độc lập khi iframe Assistant lỗi hoặc bị vô hiệu hóa.

**Exit:** Người dùng tự hoàn tất các luồng demo không cần Agent; route và trạng thái tái hiện ổn định.

### W2 — Banking API và scenario contract

- [ ] Nghiệm thu bảng `config/demo-users.yaml`: username/name/gender, duplicate/invalid validation và last-known-good reload.
- [ ] Nghiệm thu mapping user → session, address/pronoun cố định; user chưa khai báo dùng anh/chị không tên.
- [ ] Nghiệm thu `GET /api/host/assistant-data/{sessionId}`, todoList/offeringIds theo khách hàng và logout cleanup.

- [ ] Khóa request/response cho session, context, disbursement và error lookup; bổ sung OpenAPI examples.
- [ ] Validate `demo-transaction-scenarios.yaml`: version, ID/priority trùng, decimal range, outcome và error code bắt buộc.
- [ ] Thực hiện last-known-good reload; config lỗi không thay thế bản đang phục vụ và làm readiness phản ánh đúng trạng thái.
- [ ] Giữ `AppErrorRecord` gắn `sessionId`, `screenId`, `operation`, `scenarioId`, `field` và timestamp.
- [ ] Công bố base URL/version cho DemoMSBApp; xác định CORS và error envelope ổn định.
- [ ] Bổ sung persistence interface cho session/error; implementation durable để sau parity.

**Exit:** Web và Mobile dùng cùng API/scenario; mọi kết quả có `scenarioId` và không phụ thuộc Agent.

### W3 — Context và error lifecycle

- [ ] Nghiệm thu bootstrap sau login độc lập panel, context từ Host state và hủy lời thoại/đề xuất khi context đổi.

- [ ] Đăng ký Host provider một lần tại application shell; provider là nguồn ưu tiên.
- [ ] Chỉ dùng network presenter/DOM allowlist như fallback; không gửi request body, account number hoặc token.
- [ ] Pull snapshot khi Bubble mở/gửi câu hỏi; capture trước khi modal có thể unmount.
- [ ] Tách dismiss popup khỏi resolve business error.
- [ ] Resolve lỗi khi revalidation/submit thành công, route hoặc operation đổi, Host xác nhận resolved hoặc TTL hết hạn.
- [ ] Khi nhiều lỗi, chọn field vừa focus rồi priority cấu hình; giữ `sessionId/screenId/error.screenId` nhất quán.
- [ ] Đo context acquisition p95 dưới 300 ms trong môi trường demo.

**Exit:** Inline/popup error luôn tạo snapshot đúng và stale error không sống qua sự kiện resolve.

### W4 — Bridge, navigation và bảo mật

- [ ] Nghiệm thu extension scenario 1.1 opt-in, voice Web, xác nhận cả nút/voice và routeId/screenId allowlist; Done sau completed.

- [ ] Pin version `@mia/contracts` và `@mia/web-context-adapter` theo compatibility matrix.
- [ ] Kiểm tra exact `origin`, `event.source`, contract version, request ID, replay window và message type.
- [ ] Từ chối wildcard origin, URL/path tùy ý, unknown field/message và navigation ngoài allowlist.
- [ ] Map `routeId` nội bộ; trả `host.navigation.completed` với trạng thái completed/rejected.
- [ ] Cấu hình CSP `frame-src`, iframe sandbox và emergency disable flag.
- [ ] Redact PII/secrets trước khi snapshot rời Host origin; audit chỉ lưu payload đã lọc.

**Exit:** Negative tests cho wrong origin/source, replay, URL injection và sensitive fields đều đạt.

### W5 — Kiểm thử, CI và phát hành

- [ ] Chạy E2E cá nhân hóa Nam/Nữ/fallback, timing 1s/2s, x=2/3, voice fallback và isolation giữa phiên.

- [ ] Unit test scenario validator, error selection/resolution, redaction và route mapping.
- [ ] Contract tests dùng nguyên test vectors từ package MIAAssistant.
- [ ] Integration test same-origin dev và cross-origin production-like.
- [ ] Playwright: inline → Bubble, popup → Bubble, dismiss popup, fix field, route change, Assistant down.
- [ ] Test Chrome/Edge, responsive viewport, keyboard và screen-reader labels.
- [ ] CI chạy frontend build/test, API pytest, contract/E2E; build image `linux/amd64` có health/readiness.
- [ ] Pin Assistant image/adapter version và ghi rollback procedure.

**Exit:** Image độc lập chạy tại cổng cấu hình; integration suite với MIAAssistant version pin đạt.

## 4. Contract với project khác

### Với DemoMSBApp

- Cung cấp banking API base URL, OpenAPI contract và stable public error envelope.
- Không phụ thuộc source/code Mobile; thay đổi breaking phải có version/migration.

### Với MIAAssistant

- Tiêu thụ package, schema và test vectors đã phát hành; không sửa bản copy trong repo.
- Gửi `ContextSnapshot` read-only; không cấp transaction credentials hoặc mutation endpoint cho Agent.
- Nhận navigation bằng `routeId` và Host luôn là bên quyết định cuối.

## 5. Nghiệm thu bắt buộc

1. Số tài khoản/nội dung/số tiền theo scenario tạo đúng inline và popup error.
2. Mở Bubble không đóng popup, clear error hoặc gọi transaction endpoint.
3. Sửa field hợp lệ hoặc submit thành công làm snapshot sau không còn lỗi cũ.
4. Assistant iframe khác origin nhận snapshot nhưng không query được DOM Host.
5. Assistant down không ảnh hưởng login, route và giao dịch.
6. DemoMSBApp dùng cùng banking API và nhận cùng `scenarioId/errorCode` cho cùng input.
7. Agent không xuất hiện trong access log của endpoint mutation.

## 6. Sau parity

- Authentication/authorization demo nâng cao và persistence durable.
- Observability, rate limiting và deployment hardening production.
- Mở rộng nghiệp vụ/scenario sau khi contract hiện tại ổn định.

## 7. Kịch bản MIA và cá nhân hóa — nghiệm thu tích hợp

Nguồn chuẩn: [mia-scenarios.md](../../MIAAssistant/docs/mia-scenarios.md), [mia-configuration.md](../../MIAAssistant/docs/mia-configuration.md), [lộ trình](../../mia/docs/mia-delivery-roadmap.md). Các checklist mới chờ nghiệm thu tích hợp, kể cả khi code/unit tests đã có.

- [ ] User Nam đọc anh + tên; Nữ đọc chị + tên; user chưa khai báo/không xác định đọc anh/chị không tên.
- [ ] Không trộn tên/hội thoại giữa phiên; reload áp dụng login mới; logout xóa dữ liệu cũ.
- [ ] Home chào/nhắc tối đa x loại (mặc định 2), tổng chỉ nhóm được đọc; offering sau câu trước 2s.
- [ ] Lời chào ẩn 1s sau đọc, bubble vẫn còn; mở lại không phát lại; context đổi hủy tác vụ cũ.
- [ ] Hướng dẫn/lỗi dùng nguồn published; làm rõ nhiều lượt không gửi recipient/form vào prompt.
- [ ] Nút/voice đều xác nhận; Done chỉ sau completed; lỗi/permission/service thất bại có text fallback.
