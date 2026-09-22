# Tích hợp React Native

Host dùng `@mia/assistant-react-native` trong `react-native-webview`, chặn navigation ngoài exact Assistant origin và cung cấp snapshot từ navigation/error state. Không dùng accessibility, screen capture hoặc generic native bridge.


## Kịch bản MIA và cá nhân hóa

Host dùng createNativeScenarioHostHandler từ RN adapter 0.2.0 cùng context handler 1.0. WebView thường trực ngoài panel; AppState đẩy active, navigation/error đẩy contextKey. Native voice chuyên biệt chỉ TTS/STT, request permission sau thao tác bật micro. Cài dependencies rồi rebuild Android; iOS cập nhật pods/build trên macOS. Binary thiếu modules giữ text fallback.
