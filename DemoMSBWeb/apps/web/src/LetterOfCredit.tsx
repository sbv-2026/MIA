import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronDown, CirclePlus, FilePenLine, Filter, Search } from "lucide-react";
import "./letter-of-credit.css";

export type LetterOfCreditView = "letter-of-credit" | "lc-issue" | "lc-amend" | "lc-success";
export type LcDraft = { fields: Record<string, string>; missingFields: string[] };

const REQUESTS = [
  ["01:01, 05/01/2026", "LC26010501", "LC thường", "Global Import Export LLC", "40,000,000", "VND", "Bản nháp"],
  ["01:01, 05/01/2026", "LC26010502", "LC UPAS", "Ocean International Trading LLC", "30,000,000", "VND", "Chờ MSB xử lý"],
  ["01:01, 05/01/2026", "LC26010503", "LC khác", "Peaceful Import Export LLC", "40,000", "USD", "Hoàn thành"],
  ["01:01, 05/01/2026", "LC26010504", "LC thường", "Minh Quân International Trading LLC", "500,000,000", "VND", "Đã hủy"],
  ["01:01, 05/01/2026", "LC26010505", "LC UPAS", "Prosperity Import Export LLC", "60,000", "USD", "MSB đang xử lý"],
  ["01:01, 05/01/2026", "LC26010506", "LC khác", "Vietnam Global Trading LLC", "40,000", "USD", "MSB yêu cầu chỉnh sửa"],
  ["01:01, 05/01/2026", "LC26010507", "LC thường", "Bảo An Import Export LLC", "30,000,000", "VND", "Từ chối"],
  ["01:01, 05/01/2026", "LC26010508", "LC UPAS", "Hưng Thịnh International Trading LLC", "40,000", "USD", "Chờ duyệt"],
];

function statusClass(status: string) {
  if (status === "Hoàn thành") return "green";
  if (status === "Từ chối" || status === "Đã hủy") return "red";
  if (status.includes("chỉnh sửa") || status === "Chờ duyệt") return "amber";
  return "blue";
}

export function LetterOfCreditDashboard({ navigate }: { navigate: (view: LetterOfCreditView) => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => REQUESTS.filter((row) => row.some((cell) => cell.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")))), [query]);
  return <div className="page lc-page">
    <h1>Thư tín dụng</h1>
    <div className="lc-actions">
      <button onClick={() => navigate("lc-issue")}><CirclePlus/><b>Phát hành thư tín dụng</b></button>
      <button onClick={() => navigate("lc-amend")}><FilePenLine/><b>Sửa đổi thư tín dụng</b></button>
    </div>
    <section className="card lc-list">
      <div className="lc-tabs"><button className="active">Yêu cầu phát hành</button><button onClick={() => navigate("lc-amend")}>Yêu cầu sửa đổi</button></div>
      <div className="lc-search"><label><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kiếm theo mã yêu cầu"/></label><button aria-label="Lọc"><Filter/></button></div>
      <div className="lc-pills"><b>Tất cả ({rows.length})</b><span>Chờ duyệt (10)</span><span>Đang xử lý (4)</span></div>
      <div className="table-scroll"><table><thead><tr><th>Thời gian</th><th>Mã yêu cầu</th><th>Loại thư tín dụng</th><th>Bên thụ hưởng</th><th>Giá trị</th><th>Loại tiền</th><th>Trạng thái</th><th/></tr></thead><tbody>{rows.map((row) => <tr key={row[1]}>{row.map((cell, index) => <td key={cell + index}>{index === 6 ? <span className={`status ${statusClass(cell)}`}>{cell}</span> : cell}</td>)}<td>⋮</td></tr>)}</tbody></table></div>
      <div className="pagination">Hiển thị 1-{rows.length} của {rows.length} bản ghi <span>‹ &nbsp; <b>1</b> &nbsp; 2 &nbsp; 3 &nbsp; ›</span></div>
    </section>
  </div>;
}

const Input = ({ label, placeholder, value, missing }: { label: string; placeholder: string; value?: string; missing?: boolean }) => <label className={`lc-field${missing ? " lc-field-missing" : ""}`}><span>{label}</span><input key={value ?? ""} defaultValue={value} placeholder={placeholder}/>{missing && <small>Cần bổ sung thông tin</small>}</label>;
const Select = ({ label, children, value, missing }: { label: string; children: string; value?: string; missing?: boolean }) => <label className={`lc-field${missing ? " lc-field-missing" : ""}`}><span>{label}</span><div className="lc-select">{value || children}<ChevronDown/></div>{missing && <small>Cần bổ sung thông tin</small>}</label>;
const TextArea = ({ label, placeholder, hint, value, missing }: { label: string; placeholder: string; hint?: string; value?: string; missing?: boolean }) => <label className={`lc-field lc-wide${missing ? " lc-field-missing" : ""}`}><span>{label}</span><textarea key={value ?? ""} defaultValue={value} placeholder={placeholder}/>{missing && <small>Cần bổ sung thông tin</small>}{hint && <small>{hint}</small>}</label>;
const Choice = ({ label, options, value, missing }: { label: string; options: string[]; value?: string; missing?: boolean }) => <fieldset key={value ?? ""} className={"lc-choice" + (missing ? " lc-field-missing" : "")}><legend>{label}</legend><div>{options.map((option) => <label key={option}><input type="radio" name={label} defaultChecked={value === option}/><span>{option}</span></label>)}</div>{missing && <small>Cần bổ sung thông tin</small>}</fieldset>;

const LC_DOCUMENTS = [
  "Vận đơn đường biển sạch, đã xếp hàng lên tàu",
  "Hóa đơn thương mại có chữ ký",
  "Phiếu đóng gói do bên thụ hưởng phát hành",
  "Giấy chứng nhận xuất xứ",
  "Chứng thư chất lượng và số lượng",
  "Bản sao email thông báo giao hàng cho người yêu cầu",
  "Hối phiếu ký phát đòi ngân hàng phát hành",
  "Giấy chứng nhận bảo hiểm",
];
const LC_CONDITIONS = [
  "Tất cả chứng từ phải được lập bằng tiếng Anh",
  "Chứng từ của bên thứ ba được chấp nhận, trừ hối phiếu và hóa đơn",
  "Chứng từ xuất trình không được thể hiện ngày phát hành trước ngày mở L/C",
  "Sai biệt về mô tả hàng hóa không được làm thay đổi bản chất giao dịch",
  "Chứng từ do cơ quan có thẩm quyền phát hành phải được ký và đóng dấu",
];
const LC_CHARGES = [
  "Phí ngân hàng phát hành",
  "Phí ngân hàng ngoài ngân hàng phát hành",
  "Phí thông báo L/C",
  "Phí sửa đổi",
  "Phí hoàn trả",
  "Phí thương lượng chứng từ",
  "Phí xác nhận (nếu có)",
];

export function LetterOfCreditForm({ mode, navigate, initialData }: { mode: "issue" | "amend"; navigate: (view: LetterOfCreditView) => void; initialData?: LcDraft | null }) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (mode === "issue" && initialData) setStep(0); }, [mode, initialData]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (step < 3) setStep(step + 1); else navigate("lc-success"); };
  const title = mode === "issue" ? "Phát hành thư tín dụng" : "Sửa đổi thư tín dụng";
  const assisted = mode === "issue" && !!initialData;
  const fields = initialData?.fields ?? {}; const missing = new Set(initialData?.missingFields ?? []);
  const selectedValues = (key: string) => new Set((fields[key] ?? "").split("|").map(item => item.trim()).filter(Boolean));
  const selectedDocuments = selectedValues("requiredDocuments");
  const selectedConditions = selectedValues("additionalConditions");
  const commonStep = assisted ? 1 : 0; const lcStep = assisted ? 0 : 1;
  return <div className="page lc-page lc-form-page"><h1>{title}</h1>
    {assisted && <div className="lc-assistant-banner">MIA đã tự động điền dữ liệu từ PO. Các trường màu đỏ cần được bổ sung.</div>}
    <div className="lc-steps">{(assisted ? ["Thông tin L/C", "Thông tin chung", "Hồ sơ đính kèm", "Xác nhận và hoàn tất"] : ["Thông tin chung", "Thông tin L/C", "Hồ sơ đính kèm", "Xác nhận và hoàn tất"]).map((label, index) => <div className={index <= step ? "active" : ""} key={label}><b>{index + 1}</b><span>{label}</span></div>)}</div>
    <form onSubmit={submit}>
      {step === commonStep && <><section className="card lc-section"><h2>Chi nhánh/PGD MSB</h2><p>Chi nhánh/Phòng giao dịch MSB tiếp nhận và xử lý hồ sơ</p><Select label="Chi nhánh/PGD MSB">MSB Hà Nội</Select></section><section className="card lc-section"><h2>Thỏa thuận {mode === "issue" ? "phát hành" : "sửa đổi"} thư tín dụng</h2><Input label="Số thỏa thuận" placeholder="Nhập số thỏa thuận" value="TTD-LC-2026-000123"/><Input label="Ngày ký" placeholder="dd/mm/yyyy" value="24/07/2026"/></section><section className="card lc-section"><h2>Chỉ dẫn thanh toán</h2><Input label="Nguồn tiền thanh toán L/C" placeholder="Nhập nguồn tiền thanh toán L/C"/><Select label="Tài khoản thu phí">68899996789 • CÔNG TY CỔ PHẦN TẬP ĐOÀN TEST</Select><Select label="Hình thức ký quỹ">Ghi nợ tài khoản của chúng tôi tại Quý Ngân hàng</Select></section></>}
      {step === lcStep && <>
        <div className="lc-section-title"><h2>Thông tin L/C</h2><span>Thu gọn <ChevronDown/></span></div>
        <section className="card lc-section"><h2>Thông tin chung</h2><div className="lc-grid"><Select label="Loại hình L/C *" value={fields.lcType} missing={missing.has("lcType")}>{"Chọn loại hình thư tín dụng"}</Select><Select label="40A: Hình thức L/C (Form of documentary credit) *" value={fields.issueMode} missing={missing.has("issueMode")}>{"Chọn hình thức L/C"}</Select></div></section>
        <section className="card lc-section"><h2>Giá trị thư tín dụng</h2><div className="lc-grid lc-value-grid"><Select label="32B: Loại tiền (Currency) *" value={fields.currency} missing={missing.has("currency")}>{"USD"}</Select><Input label="32B: Số tiền (Currency, Amount) *" placeholder="Nhập giá trị thư tín dụng" value={fields.amount} missing={missing.has("amount")}/><Input label="39A: Dung sai dương (%)" placeholder="Nhập tỷ lệ +" value={fields.positiveTolerance} missing={missing.has("positiveTolerance")}/><Input label="39A: Dung sai âm (%)" placeholder="Nhập tỷ lệ -" value={fields.negativeTolerance} missing={missing.has("negativeTolerance")}/></div></section>

        <div className="lc-section-title"><h2>Các bên liên quan</h2><span>Thu gọn <ChevronDown/></span></div>
        <section className="card lc-section"><h2>50: Thông tin người yêu cầu phát hành (Applicant)</h2><div className="lc-grid"><Input label="Tên đầy đủ (Full name) *" placeholder="Nhập tên người phát hành" value={fields.applicantName} missing={missing.has("applicantName")}/><Input label="Mã số thuế (Tax No.)" placeholder="Nhập mã số thuế" value={fields.applicantTaxNo} missing={missing.has("applicantTaxNo")}/><Input label="Địa chỉ (Address) *" placeholder="Nhập địa chỉ" value={fields.applicantAddress} missing={missing.has("applicantAddress")}/><Input label="Tỉnh/Thành phố (Town/City/State)" placeholder="Nhập tỉnh/thành phố" value={fields.applicantCity} missing={missing.has("applicantCity")}/><Input label="Quốc gia (Country) *" placeholder="Nhập quốc gia" value={fields.applicantCountry} missing={missing.has("applicantCountry")}/><Input label="Mã bưu chính (Post Code)" placeholder="Nhập mã bưu chính" value={fields.applicantPostCode} missing={missing.has("applicantPostCode")}/><TextArea label="Địa chỉ chi tiết (Detailed address)" placeholder="Nhập địa chỉ chi tiết" value={fields.applicantDetailedAddress} missing={missing.has("applicantDetailedAddress")}/></div></section>
        <section className="card lc-section"><h2>59: Thông tin người thụ hưởng (Beneficiary)</h2><div className="lc-grid"><Input label="Tên đầy đủ (Full name) *" placeholder="Nhập tên người thụ hưởng" value={fields.beneficiaryName} missing={missing.has("beneficiaryName")}/><Input label="Mã số thuế (Tax No.)" placeholder="Nhập mã số thuế" value={fields.beneficiaryTaxNo} missing={missing.has("beneficiaryTaxNo")}/><Input label="Địa chỉ (Address) *" placeholder="Nhập địa chỉ" value={fields.beneficiaryAddress} missing={missing.has("beneficiaryAddress")}/><Input label="Tỉnh/Thành phố (Town/City/State)" placeholder="Nhập tỉnh/thành phố" value={fields.beneficiaryCity} missing={missing.has("beneficiaryCity")}/><Input label="Quốc gia (Country) *" placeholder="Nhập quốc gia" value={fields.beneficiaryCountry} missing={missing.has("beneficiaryCountry")}/><Input label="Mã bưu chính (Post Code)" placeholder="Nhập mã bưu chính" value={fields.beneficiaryPostCode} missing={missing.has("beneficiaryPostCode")}/><TextArea label="Địa chỉ chi tiết (Detailed address)" placeholder="Nhập địa chỉ chi tiết" value={fields.beneficiaryDetailedAddress} missing={missing.has("beneficiaryDetailedAddress")}/></div></section>
        <section className="card lc-section"><h2>57A: Thông tin ngân hàng thông báo (Advising Bank)</h2><div className="lc-grid"><Input label="Mã SWIFT *" placeholder="Nhập mã SWIFT" value={fields.swift} missing={missing.has("swift")}/><Input label="Tên ngân hàng thông báo *" placeholder="Nhập tên ngân hàng" value={fields.bankName} missing={missing.has("bankName")}/><Input label="Tên chi nhánh" placeholder="Nhập tên chi nhánh" value={fields.bankBranch} missing={missing.has("bankBranch")}/><Input label="Địa chỉ ngân hàng" placeholder="Nhập địa chỉ ngân hàng" value={fields.bankAddress} missing={missing.has("bankAddress")}/></div></section>

        <div className="lc-section-title"><h2>Các thông tin thanh toán</h2><span>Thu gọn <ChevronDown/></span></div>
        <section className="card lc-section"><h2>Thông tin thanh toán</h2><div className="lc-grid"><Input label="31D: Ngày hết hạn (Expiry Date) *" placeholder="dd/mm/yyyy" value={fields.expiryDate} missing={missing.has("expiryDate")}/><Input label="31D: Địa điểm hết hạn (Place of Expiry) *" placeholder="Nhập địa điểm hết hạn" value={fields.expiryPlace} missing={missing.has("expiryPlace")}/><Select label="41A: Có giá trị tại… (Available with…) *" value={fields.availableWith} missing={missing.has("availableWith")}>Chọn ngân hàng</Select><Select label="41A: Bằng… (By…) *" value={fields.availableBy} missing={missing.has("availableBy")}>Chọn phương thức</Select><Choice label="Hối phiếu trả tiền tại (Drafts at)" options={["Có", "Không"]} value={fields.draftsAt} missing={missing.has("draftsAt")}/><Input label="42C: Kỳ hạn hối phiếu" placeholder="Nhập kỳ hạn" value={fields.draftTenor} missing={missing.has("draftTenor")}/></div></section>
        <section className="card lc-section"><h2>Thông tin hàng hóa/dịch vụ</h2><div className="lc-grid"><Choice label="43P: Giao hàng từng phần (Partial Shipments)" options={["Cho phép", "Không cho phép"]} value={fields.partialShipments} missing={missing.has("partialShipments")}/><Choice label="43T: Chuyển tải (Transshipment)" options={["Cho phép", "Không cho phép"]} value={fields.transshipment} missing={missing.has("transshipment")}/><Input label="44A: Nơi nhận hàng/địa điểm gửi hàng" placeholder="Nhập địa điểm" value={fields.receiptPlace} missing={missing.has("receiptPlace")}/><Input label="44B: Nơi giao hàng cuối cùng" placeholder="Nhập địa điểm" value={fields.finalDestination} missing={missing.has("finalDestination")}/><Input label="44E: Cảng xếp hàng/Sân bay khởi hành" placeholder="Nhập cảng hoặc sân bay" value={fields.loadingPort} missing={missing.has("loadingPort")}/><Input label="44F: Cảng dỡ hàng/Sân bay đến" placeholder="Nhập cảng hoặc sân bay" value={fields.dischargePort} missing={missing.has("dischargePort")}/><Input label="44C: Ngày giao hàng muộn nhất" placeholder="dd/mm/yyyy" value={fields.latestShipmentDate} missing={missing.has("latestShipmentDate")}/><Input label="44D: Thời hạn giao hàng" placeholder="Nhập thời hạn giao hàng" value={fields.shipmentPeriod} missing={missing.has("shipmentPeriod")}/><Select label="Incoterms *" value={fields.incoterms} missing={missing.has("incoterms")}>{"Chọn Incoterms"}</Select><Select label="Điều kiện giao hàng" value={fields.deliveryTerms} missing={missing.has("deliveryTerms")}>Chọn điều kiện giao hàng</Select><TextArea label="45A: Mô tả hàng hóa/dịch vụ *" placeholder="Nhập mô tả hàng hóa/dịch vụ" value={fields.goodsDescription} missing={missing.has("goodsDescription")} hint="Nêu rõ tên hàng, số lượng, đơn giá, quy cách và thông tin hợp đồng liên quan."/></div><div className="lc-guidance"><b>Lưu ý khi mô tả hàng hóa/dịch vụ</b><ul><li>Tên hàng hóa hoặc dịch vụ cần rõ ràng, chính xác.</li><li>Không sử dụng các ký hiệu hoặc mô tả gây nhầm lẫn.</li><li>Nội dung phải phù hợp với hợp đồng và chứng từ thương mại.</li></ul></div></section>

        <div className="lc-section-title"><h2>Yêu cầu bộ chứng từ</h2><span>Thu gọn <ChevronDown/></span></div>
        <section className={`card lc-section${missing.has("requiredDocuments") ? " lc-field-missing" : ""}`}><Choice label="48: Thời hạn xuất trình chứng từ (Period for Presentation in Days)" options={["Trong thời hạn hiệu lực của L/C", "Theo số ngày quy định"]} value={fields.presentationPeriod} missing={missing.has("presentationPeriod")}/><h2 className="lc-subheading">46A: Chứng từ yêu cầu (Documents required)</h2><div className="lc-document-head"><span>Loại chứng từ</span><span>Số bản gốc</span><span>Số bản sao</span></div>{LC_DOCUMENTS.map((document) => <div className="lc-document-row" key={document}><label><input type="checkbox" defaultChecked={selectedDocuments.has(document)}/>{document}</label><input inputMode="numeric" placeholder="0"/><input inputMode="numeric" placeholder="0"/></div>)}{missing.has("requiredDocuments") && <small>Cần bổ sung thông tin</small>}<button className="lc-add-row" type="button">+ Thêm chứng từ khác</button></section>

        <div className="lc-section-title"><h2>Điều khoản và điều kiện</h2><span>Thu gọn <ChevronDown/></span></div>
        <section className={`card lc-section${missing.has("additionalConditions") ? " lc-field-missing" : ""}`}><h2>47A: Điều kiện bổ sung (Additional conditions)</h2>{LC_CONDITIONS.map((condition) => <label className="lc-check" key={condition}><input type="checkbox" defaultChecked={selectedConditions.has(condition)}/>{condition}</label>)}{missing.has("additionalConditions") && <small>Cần bổ sung thông tin</small>}<button className="lc-add-row" type="button">+ Thêm điều kiện khác</button></section>
        <section className="card lc-section"><h2>71B: Thông tin phí (Charges)</h2><div className="lc-charge-head"><span>Loại phí</span><span>Bên phát hành chịu phí</span><span>Bên thụ hưởng chịu phí</span></div>{LC_CHARGES.map((charge) => <div className="lc-charge-row" key={charge}><span>{charge}</span><input type="radio" name={charge}/><input type="radio" name={charge}/></div>)}<button className="lc-add-row" type="button">+ Thêm phí khác</button></section>
        <section className="card lc-section"><h2>Điều kiện khác</h2><Select label="49: Chỉ dẫn xác nhận (Confirmation instruction)">Chọn chỉ dẫn xác nhận</Select></section>
      </>}
      {step === 2 && <><section className="card lc-section"><h2>Hồ sơ đính kèm</h2><div className="lc-upload"><FilePenLine/><b>Kéo thả hoặc chọn tệp hồ sơ</b><p>PDF, DOCX, XLSX; tối đa 10 MB mỗi tệp</p><button type="button" className="outline-button">Chọn tệp</button></div></section><section className="card lc-section"><h2>Yêu cầu bộ chứng từ</h2>{["Commercial invoice", "Packing list", "Certificate of Origin", "Bill of Lading"].map((item) => <label className="lc-check" key={item}><input type="checkbox" defaultChecked/>{item}</label>)}</section></>}
      {step === 3 && <section className="card lc-section lc-confirm"><h2>Xác nhận và hoàn tất</h2><div className="lc-review"><span>Loại yêu cầu</span><b>{title}</b><span>Loại L/C</span><b>UPAS L/C</b><span>Giá trị</span><b>50,000 USD</b><span>Người thụ hưởng</span><b>Shandong Auto Parts Trading Co., Ltd</b></div><label className="lc-check"><input type="checkbox" required/>Tôi xác nhận thông tin trên là chính xác và đồng ý với điều khoản giao dịch.</label></section>}
      <div className="lc-form-actions"><button type="button" className="outline-button" onClick={() => step ? setStep(step - 1) : navigate("letter-of-credit")}>Quay lại</button><button className="primary-button">{step === 3 ? "Tạo lệnh" : "Tiếp tục"}</button></div>
    </form>
  </div>;
}

export function LetterOfCreditSuccess({ navigate }: { navigate: (view: LetterOfCreditView) => void }) {
  return <div className="page lc-success"><section className="card"><span className="lc-success-icon"><Check/></span><h1>Tạo lệnh thành công</h1><p>Yêu cầu phát hành thư tín dụng đã được ghi nhận.</p><div className="lc-reference"><span>Mã yêu cầu</span><b>LC26092001</b><span>Trạng thái</span><b className="status amber">Chờ duyệt</b></div><div><button className="outline-button" onClick={() => navigate("letter-of-credit")}>Về danh sách</button><button className="primary-button" onClick={() => navigate("lc-issue")}>Tạo yêu cầu mới</button></div></section></div>;
}
