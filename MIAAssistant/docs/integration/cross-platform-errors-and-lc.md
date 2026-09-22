# Nguyên tắc tích hợp Web/Mobile cho lỗi và phát hành L/C

MIA không chờ người dùng hỏi về lỗi. Host phải phát `ContextSnapshot` ngay khi lỗi được trình bày, còn Agent ưu tiên utterance lỗi cao hơn lời chào và nội dung chủ động khác trên mọi màn hình.

## Lỗi nghiệp vụ

Luồng dùng chung cho Web và Mobile:

1. Tầng gọi API hoặc state store nhận lỗi nghiệp vụ.
2. UI hiển thị lỗi và đồng thời cập nhật `screenState=error`, `lastErrorId`, `errorCode`, `lastOperation` cùng `CurrentErrorSnapshot` tương ứng.
3. Host gọi `scenarioHost.update(...)`. Assistant tự yêu cầu snapshot, phát hiện `errorId` mới và đọc câu “MIA phát hiện màn hình đang có mã lỗi …”.
4. Khi lỗi biến mất, Host trả snapshot có `error=null` và xóa các trường lỗi trong context.

Web có thể dùng `reportPresentedError` của `@mia/web-context-adapter`; DOM selector chỉ là fallback. Mobile dùng `createAssistantMessageHandler` với callback `snapshot()` và `createNativeScenarioHostHandler`; sau mỗi thay đổi error state, gọi `update`. Không viết điều kiện riêng cho Giải ngân, Bảo lãnh hay từng mã lỗi trong Assistant.

`errorId` phải ổn định trong vòng đời một lần hiển thị lỗi và thay đổi khi lỗi mới xuất hiện. `operation + errorCode` là khóa tra cứu knowledge; `screenId` chỉ mô tả nơi lỗi đang được trình bày.

## Trường Thông tin L/C

Form Host là nguồn chuẩn qua `/api/host/lc-fields/{sessionId}`. Mỗi định nghĩa trường gồm `key`, `label`, `section`, `kind`, `required` và `options` khi có lựa chọn. Các loại tương tác dùng chung:

- `text`, `textarea`, `date`: nhập bằng chat/voice;
- `choice`: MIA hiển thị radio;
- `checkbox`: MIA hiển thị checklist nhiều lựa chọn;
- `select`: MIA dùng danh mục khi Host có cung cấp `options`; nếu chưa có thì hỏi bằng chat/voice và Host vẫn là nơi kiểm tra giá trị.

Khi đọc trường có tag SWIFT ở đầu label, MIA luôn thêm tiền tố “trường thông tin”, ví dụ `43P: Giao hàng từng phần` được đọc là “trường thông tin 43P, Giao hàng từng phần”. Giá trị đã thu thập được giữ trong LC draft và gửi qua sự kiện `assistant.lc.autofill`; Web hoặc Mobile map `key` vào control tương ứng trên form.

Sau mỗi trường, MIA hỏi người dùng tiếp tục cung cấp trên MIA hay tự điền trên form. Lần hỏi đầu có thêm “Không hỏi lại”; khi chọn, MIA tiếp tục tuần tự các trường còn thiếu mà không chèn lại bước xác nhận.
