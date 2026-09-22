# Tích hợp Web

Host tạo `@mia/web-context-adapter`, đăng ký context provider và gọi `attachBridge` với `iframe.contentWindow` cùng exact Assistant origin. Iframe URL nhận `sessionId` và `hostOrigin`; CSP Host chỉ cho phép Assistant origin.


## Kịch bản MIA và cá nhân hóa

Host dùng createMiaScenarioHostHandler cùng createWebVoice từ adapter 0.2.2, chạy iframe thường trực từ login. Adapter 0.2.2 bổ sung VieNeu Cloud realtime với fallback Web Speech API. Chỉ append scenarioVersion=1.1 khi config/readiness cùng hỗ trợ; xác thực exact origin/source trước khi dispatch. Runtime gửi contextKey/panelOpen/active/greeted và features thực tế. data provider gọi banking API riêng, không ghép recipient vào ContextSnapshot. Backend cleanup lịch sử khi logout là best effort; phiên mới luôn dùng sessionId mới.
