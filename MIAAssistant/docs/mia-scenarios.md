# Kịch bản MIA — Web và Mobile

## Bổ sung DemoMSBWeb: việc cụ thể và thông tin tín dụng

MIA hiển thị theme liquid glass bên trong iframe: nền tối, ánh xanh và nâu vàng,
thẻ kính mờ và nút vàng. Tên hiển thị MIA, phiên âm Mi - A; host chuyển tên này
trong mọi yêu cầu Web Voice. Khi chọn nhóm chức năng, menu nhóm không liên quan được ẩn.
Home xóa câu trả lời và đích chờ xác nhận để về menu gốc.

Dữ liệu cầu nối vẫn dùng `id`/`todoType`, bổ sung các trường tùy chọn `loanAccount`,
`business`, `dueDate`, `amount`. YAML DemoMSBWeb dùng `todolistID`/`todotype`;
host chuyển tên trường khi trả API cho cầu nối. Hợp đồng 1.1 vẫn nhận dữ liệu cũ.

| todotype | Màn hình host | Khóa định danh |
| --- | --- | --- |
| overdue-loan | credit-information | todoId → loanAccount |
| document-debt | documents-management | todoId → business |
| password-change | password-change | todoId → dueDate |

Box “Việc cần làm” mở các box chức năng level 2 theo `todoType`. Chọn một box,
ví dụ “khoản vay quá hạn”, mới hiển thị danh sách tài khoản thuộc nhóm đó.
Chạm việc/tài khoản cụ thể gửi `assistant.navigation.requested` ngay với `todoId` và
`confirmed: true`; runtime không gọi mô hình và Host tự kiểm tra việc còn thuộc phiên.
Yêu cầu được nhập trong chat hoặc nói qua micro luôn đi qua `/api/agent/chat` để mô hình
suy luận ý định, kể cả khi nội dung có số tài khoản hoặc tên một nhóm việc.

Khách hàng chủ động bấm micro để bắt đầu phiên nói chuyện. Với yêu cầu giọng nói hoặc
chat có đích cụ thể, MIA dùng kết quả suy luận để hỏi làm rõ hay đề xuất điều hướng.
Khi micro hoặc giọng đọc không khả dụng, dùng nội dung chữ và các box chức năng.

Host kiểm tra việc thuộc đúng phiên và khớp màn hình được phép, rồi tra lại `todoId`
để lấy số tài khoản. Màn hình tín dụng dùng cùng dữ liệu tài khoản này cho bảng và sidebar.
Sidebar desktop chiếm 1/3 bên phải, mobile toàn chiều rộng; có thông tin khoản vay,
lịch sử giao dịch và lịch trả nợ dự kiến. Tổng quan tính từ các khoản vay của khách hàng.
Số dư/lãi/giải ngân còn lại là dữ liệu mô phỏng suy ra từ số tiền quá hạn trong YAML.


Tài liệu nghiệp vụ chuẩn cho DemoMSBWeb và DemoMSBApp. Cấu hình và ownership: [mia-configuration.md](mia-configuration.md). Lộ trình: [mia-delivery-roadmap.md](../../mia/docs/mia-delivery-roadmap.md).

## S0 — Người dùng và xưng hô

DemoMSBWeb tra cứu tài khoản tại backend khi tạo phiên. Cấu hình Nam dùng `anh {name}` và đại từ `anh`; Nữ dùng `chị {name}` và `chị`. User chưa khai báo hoặc giới tính Không xác định dùng `anh/chị`, không đọc tên. Không suy đoán giới tính hoặc dùng username/tên mặc định trong lời thoại.

| User | Lời chào |
|---|---|
| minh / Minh / Nam | Xin chào anh Minh, MIA sẵn sàng hỗ trợ anh ạ. |
| lan / Lan / Nữ | Xin chào chị Lan, MIA sẵn sàng hỗ trợ chị ạ. |
| User có giới tính Không xác định | Xin chào anh/chị, MIA sẵn sàng hỗ trợ anh/chị ạ. |
| User chưa khai báo | Xin chào anh/chị, MIA sẵn sàng hỗ trợ anh/chị ạ. |

Backend tạo `address` và `pronoun` cố định trong phiên; chữ và giọng nói dùng cùng template. Tên giữ nguyên theo cấu hình. Reload cấu hình áp dụng từ login mới. Logout xóa thông tin phiên; hai phiên không dùng tên hoặc lịch sử của nhau.

Khi VieNeu TTS được bật, ba nhánh giọng nói tương ứng là: Nam dùng `VIENEU_VOICE_MALE` (mặc định `Quang Định`), Nữ dùng `VIENEU_VOICE_FEMALE` (mặc định `Mai An`), và Không xác định/user chưa khai báo dùng `VIENEU_VOICE` (mặc định `Quang Định`). Việc chọn giọng dựa trên đại từ do backend cấp, không suy đoán từ tên.

## S1 — Sau login tại Home

1. Khi phiên và context Home sẵn sàng, hiện bubble có tên MIA. Runtime chạy độc lập với panel mở/đóng.
2. Hiện và đọc lời chào S0. Một giây sau khi đọc xong, ẩn khung lời chào; bubble vẫn còn.
3. Nếu có việc, đọc tối đa `x` nhóm ưu tiên, mặc định 2.
4. Nếu có offering, chờ 2 giây sau câu trước đọc xong rồi đọc offering. Không có việc thì câu trước là lời chào.

Chuỗi chủ động chạy một lần mỗi phiên; mở lại panel/quay Home không phát lại. Khi chạm MIA, gửi câu hỏi, đổi màn hình, logout hoặc background, hủy lời thoại đang chờ. Không tự thu âm. Giọng nói không khả dụng giữ nội dung chữ và nút Đọc lại / bật âm thanh.

### S1.1 — Việc cần làm

- `y`: số việc còn cần làm trong toàn bộ todoList; `n`: số loại có dữ liệu.
- `x`: giới hạn số loại được đọc, không phải giới hạn số công việc.
- Group theo todoType; tên lấy todoName; nhóm không rỗng và enabled được đọc.
- Sắp priority số lớn trước; hòa ưu tiên theo todoType. Lấy tối đa x nhóm.
- spokenTodoCount chỉ là tổng số công việc trong các nhóm được chọn.
- Panel giữ danh sách đầy đủ, kể cả nhóm ngoài giới hạn được đọc. Không có việc thì bỏ qua lời nhắc.

Mẫu:

> {address} ơi, MIA đang thấy {pronoun} có {spokenTodoCount} việc cần làm, đó là {groups}.

Ví dụ 3 phê duyệt, 2 bổ sung hồ sơ, 1 thanh toán: x=2 đọc “Anh Minh ơi, MIA đang thấy anh có 5 việc cần làm, đó là 3 việc phê duyệt, 2 việc bổ sung hồ sơ.” x=3 đọc 6 việc và thêm nhóm thanh toán.

### S1.2 — Offering

Eligibility do dữ liệu khách hàng DemoMSBWeb quyết định bằng offeringIds; MIA không suy đoán khách hàng đủ điều kiện. Chỉ chọn sản phẩm còn hiệu lực, ưu tiên cao nhất; hòa ưu tiên theo ID. MVP chủ động giới thiệu một sản phẩm.

> {address} ơi. Hiện tại bên MSB đang có sản phẩm “{productName}”, MIA thấy phù hợp với bên mình ạ. {pronoun} cần cung cấp thông tin thêm không ạ?

Chọn tìm hiểu để xem description/details từ catalog cấu hình. Không có offering thì không đọc và không hiện mục sản phẩm.

### S1.3 — Chạm MIA

Menu Home:

- Việc cần làm: xem danh sách đầy đủ và chọn đích tính năng liên quan.
- Tìm hiểu thêm về sản phẩm “{productName}”: chỉ hiện nếu có offering.
- Hướng dẫn sử dụng: hỏi “{address} muốn tìm hướng dẫn sử dụng phần nào ạ?”, chọn tính năng rồi chủ đề.
- Khác: nhận câu hỏi tự do; nếu chưa rõ hoặc chưa hỗ trợ thì hỏi lại và đưa menu phù hợp.

Hướng dẫn/offering trình bày trong panel MIA. Truy cập tính năng là action riêng, không tự chuyển màn khi chọn xem nội dung.

## S2 — Màn hình chức năng

### S2.1 — Có lỗi còn hiệu lực

MIA mời hỗ trợ một lần theo errorId trong phiên/màn hình:

> MIA phát hiện màn hình đang có lỗi. {address} cần MIA hỗ trợ không ạ?

Khách hàng đồng ý qua lựa chọn hỗ trợ hoặc câu hỏi thì:

1. **S2.1.1 Tra cứu lỗi:** dùng operation + errorCode từ snapshot hợp lệ, trả description, steps và citations của knowledge published.
2. **S2.1.2 Làm rõ thêm:** gọi model với hướng dẫn published và các lượt hướng dẫn đã trả trước đó cho cùng lỗi. Giữ tên/xưng hô ngoài prompt; backend ghép lời dẫn cá nhân hóa sau khi có kết quả.

Không có mapping: nói rõ chưa có hướng dẫn. Model lỗi: trả hướng dẫn cấu hình. Khi resolve/route/operation/error đổi, lịch sử lỗi cũ không dùng để nhắc lại hoặc làm rõ.

Nếu từ chối, không tự nhắc lại cùng lỗi; khách hàng vẫn có thể mở panel để yêu cầu hỗ trợ.

### S2.2 — Không có lỗi

- Hướng dẫn tính năng hiện tại, chọn bằng screenId + operation; đi sâu theo chủ đề và steps.
- Offering phù hợp hiện có.
- Các tư vấn khác; ý định chưa rõ thì hỏi lại.

Màn hình/chủ đề chưa có nguồn published phải thông báo chưa có hướng dẫn; không tạo quy trình ngân hàng mới.

## S3 — Giọng nói, xác nhận và điều hướng

Cả nút bấm và giọng nói đều tạo đề xuất, chưa chuyển màn hình:

> {address} muốn truy cập vào “{featureName}”, đúng không ạ?

Hiện Xác nhận / Hủy. Giọng nói “xác nhận”, “đồng ý”, “đúng”, “đúng rồi” xác nhận đề xuất hiện tại; “hủy”, “không”, “không đúng” hủy. Không có đề xuất thì không dùng các từ này để tự điều hướng. Ý định khớp nhiều tính năng phải hỏi lại.

Sau xác nhận, gửi routeId/screenId qua bridge. Host kiểm tra danh mục đích thực tế, phiên, contextKey và trả completed/rejected. MIA chỉ báo thành công sau completed. Timeout/rejected có thông báo và cho thử lại; context đổi hủy đề xuất cũ. MIA không submit, sửa, hủy hoặc retry giao dịch.

Web dùng voice của trình duyệt khi hỗ trợ; Mobile dùng TTS/STT native. Microphone chỉ được bật bằng thao tác khách hàng; permission/service lỗi dùng text fallback. Dừng/hủy/background ngắt cả lời đọc và thu âm.

## S4 — Trạng thái

| State | Điều kiện | Icon |
|---|---|---|
| Idle | Chờ tương tác/xác nhận | Mặt cười nhẹ |
| Listening | Đang nhận giọng nói | Mặt lắng nghe/micro |
| Thinking | Phân tích, truy xuất, chờ model | Mặt suy nghĩ/ba chấm |
| Working | Đọc hoặc chờ Host điều hướng | Mặt tập trung/tiến trình |
| Done | Yêu cầu hoàn tất thành công | Mặt vui/dấu tích |

Done giữ 1 giây rồi về Idle. Hủy/lỗi về Idle kèm thông báo, không dùng Done cho navigation thất bại. Kết nối/offline tách khỏi state. Icon có nhãn accessibility; không yêu cầu animation nên phù hợp chế độ giảm chuyển động.

## Nghiệm thu

- Nam/Nữ/fallback đúng cả chữ và giọng nói; không trộn tên giữa phiên.
- Thời gian ẩn lời chào 1 giây, offering sau câu trước 2 giây; không phát lặp khi mở lại.
- x=2/3, số nhóm ít hơn x, data rỗng, dữ liệu lỗi, danh sách đầy đủ, hòa ưu tiên.
- Offering hết hiệu lực/không phù hợp không được giới thiệu.
- Lỗi resolve/stale/đổi màn hình không dùng lại; thiếu mapping/model timeout có fallback.
- Cả hai phương thức nhập cần xác nhận; context đổi, route lạ, replay, timeout/rejected không báo thành công.
- Android/iOS/Web có text fallback và Host vẫn hoạt động khi Assistant lỗi.
