import { useEffect, useState, type KeyboardEvent } from "react";
import type { ScenarioRuntime } from "./scenario-runtime";

type Contact = { user_email?: string; CIF_Number?: string; username: string; fullName: string; phoneNumber: string; companyName: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizedEmails(values: string[]) {
  return [...new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean))];
}

export function SupportHandoff({ runtime, errorId, onDismiss }: { runtime: ScenarioRuntime | null; errorId: string; onDismiss: () => void }) {
  const accepted = true;
  const saved = runtime?.supportDrafts.get(errorId);
  const visibility = (hidden: boolean) => new Promise<void>((resolve, reject) => {
    if (window.parent === window) { reject(new Error("MIA cần được mở trong ứng dụng ngân hàng để chụp màn hình.")); return; }
    const requestId = crypto.randomUUID();
    const origin = new URLSearchParams(location.search).get("hostOrigin") ?? "";
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Chưa ẩn được khung MIA. Vui lòng thử lại.")); }, 3000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== window.parent || event.data?.type !== "host.capture.visibility" || event.data.requestId !== requestId) return;
      clearTimeout(timer); window.removeEventListener("message", receive); resolve();
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "assistant.capture.visibility", sessionId: new URLSearchParams(location.search).get("sessionId"), requestId, hidden }, origin);
  });
  const [contact, setContact] = useState<Contact>((saved?.contact as Contact) ?? { username: "", fullName: "", phoneNumber: "", companyName: "" });
  const [recipientEmails, setRecipientEmails] = useState<string[]>((saved?.recipientEmails as string[]) ?? []);
  const [emailDraft, setEmailDraft] = useState((saved?.emailDraft as string) ?? "");
  const [image, setImage] = useState((saved?.image as string) ?? "");
  const [notice, setNotice] = useState((saved?.notice as string) ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ticketId: string; channels: Record<string, string>; message: string } | null>((saved?.result as { ticketId: string; channels: Record<string, string>; message: string }) ?? null);
  useEffect(() => { runtime?.supportDrafts.set(errorId, { contact, recipientEmails, emailDraft, image, notice, result }); }, [runtime, errorId, contact, recipientEmails, emailDraft, image, notice, result]);
  useEffect(() => {
    let active = true;
    if (accepted) void runtime?.support("profile").then(value => {
      if (!active) return;
      const profile = value.profile as Contact;
      setContact(profile);
      setRecipientEmails(current => current.length || !profile.user_email ? current : [profile.user_email.toLowerCase()]);
    }).catch(() => { if (active) setNotice("MIA chưa tải được thông tin khách hàng. Vui lòng thử lại."); });
    return () => { active = false; };
  }, [accepted, runtime]);
  const currentError = runtime?.view.snapshot?.error?.errorId === errorId;
  const address = runtime?.view.recipient?.address ?? "anh/chị";
  const addEmails = (raw: string, keepLast = false) => {
    const parts = raw.split(",");
    const pending = keepLast ? parts.pop() ?? "" : "";
    const candidates = parts.map(value => value.trim()).filter(Boolean);
    const invalid = candidates.find(value => !EMAIL.test(value));
    if (invalid) { setNotice(`Email không hợp lệ: ${invalid}`); return false; }
    setRecipientEmails(current => normalizedEmails([...current, ...candidates]).slice(0, 10));
    setEmailDraft(pending.trimStart());
    setNotice("");
    return true;
  };
  const finishEmail = () => emailDraft.trim() ? addEmails(emailDraft) : true;
  const emailKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault(); finishEmail();
  };
  const capture = async () => {
    let stream: MediaStream | null = null;
    setBusy(true); setNotice("");
    try {
      const draft = emailDraft.trim();
      if (draft && !EMAIL.test(draft)) throw new Error(`Email không hợp lệ: ${draft}`);
      const recipients = normalizedEmails([...recipientEmails, ...(draft ? [draft] : [])]);
      if (!recipients.length) throw new Error("Vui lòng nhập ít nhất một email nhận thông báo.");
      if (recipients.length > 10) throw new Error("Chỉ được nhập tối đa 10 email nhận thông báo.");
      setRecipientEmails(recipients); setEmailDraft("");
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error(`Trình duyệt chưa hỗ trợ chụp tab. ${address} vui lòng dùng Chrome hoặc Edge.`);
      const options = { video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true };
      stream = await navigator.mediaDevices.getDisplayMedia(options);
      const surface = stream.getVideoTracks()[0].getSettings().displaySurface;
      if (surface && surface !== "browser") throw new Error(`${address} vui lòng chọn tab ứng dụng ngân hàng để chụp đúng màn hình lỗi.`);
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true;
      await visibility(true);
      await video.play();
      // Allow the captured tab compositor to deliver frames after hiding MIA.
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      if (!video.videoWidth || !video.videoHeight) throw new Error(`MIA chưa nhận được ảnh màn hình. ${address} vui lòng thử lại.`);
      const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const screenshot = canvas.toDataURL("image/png");
      setImage(screenshot);
      runtime?.supportDrafts.set(errorId, { contact, recipientEmails: recipients, emailDraft: "", image: screenshot, notice: "", result: null });
      await visibility(false);
      const value = await runtime?.support("submit", { phoneNumber: contact.phoneNumber, companyName: contact.companyName, recipientEmails: recipients, screenshot, consent: true, errorId });
      runtime?.supportDrafts.set(errorId, { contact, recipientEmails: recipients, emailDraft: "", image: screenshot, notice: "", result: value?.result });
      setResult(value?.result as typeof result);
      video.srcObject = null;
    } catch (error) {
      setNotice(error instanceof Error && error.name !== "NotAllowedError" ? error.message : `${address} chưa cho phép chụp màn hình. MIA chưa gửi thông tin nào.`);
    } finally { await visibility(false).catch(() => {}); stream?.getTracks().forEach(track => track.stop()); setBusy(false); }
  };
  if (result && result.channels.email === "sent") return <div><p role="status">{result.message} Mã hồ sơ: {result.ticketId}.</p>{image && <img className="mia-support-preview" src={image} alt={`Ảnh màn hình lỗi của ${address}`}/>}</div>;
  return <div className="mia-support-review">
    <p>{address} vui lòng kiểm tra thông tin. MIA sẽ gửi mã lỗi, mô tả, các bước đã hướng dẫn, nội dung trao đổi, tài khoản người dùng, URL, tính năng và ảnh chụp tới cán bộ hỗ trợ qua email.</p>
    <label>Khách hàng<input readOnly value={contact.fullName}/></label><small>Tài khoản: {contact.username}</small>
    <label>Số điện thoại<input readOnly value={contact.phoneNumber} autoComplete="tel"/></label>
    <label>Tên doanh nghiệp<input readOnly value={contact.companyName} autoComplete="organization"/></label>
    <label>Email nhận thông báo
      <div className="mia-email-entry" onClick={event => event.currentTarget.querySelector("input")?.focus()}>
        {recipientEmails.map(email => <span className="mia-email-chip" key={email}>{email}<button type="button" aria-label={`Xóa email ${email}`} onClick={() => setRecipientEmails(current => current.filter(value => value !== email))}>×</button></span>)}
        <input aria-label="Thêm email nhận thông báo" type="email" inputMode="email" value={emailDraft} placeholder={recipientEmails.length ? "Thêm email khác" : "email@example.com"} onChange={event => { const value = event.currentTarget.value; setEmailDraft(value); if (value.includes(",")) addEmails(value, true); }} onKeyDown={emailKey} onBlur={() => finishEmail()}/>
      </div>
      <small>Nhập một hoặc nhiều email, cách nhau bằng dấu phẩy.</small>
    </label>
    <button disabled={busy || !contact.username || !currentError} onClick={() => void capture()}>{busy ? "MIA đang chụp và gửi…" : result ? "Thử chụp và gửi lại" : "Chụp màn hình lỗi và gửi tới MSB"}</button>
    {image && <img className="mia-support-preview" src={image} alt={`Ảnh màn hình lỗi của ${address}`}/>}
    {notice && <p role="alert">{notice}</p>}{result && <p role="status">{result.message}</p>}
    <button disabled={busy} onClick={onDismiss}>Không gửi</button>
  </div>;
}
