var API_URL = "https://checkordertiktok-seven.vercel.app/api/check-order";

var STATUS_STYLES = {
  DELIVERED: { bg: "#bbf7d0", fg: "#14532d" }, // Xanh lá (Đã giao / Hoàn thành)
  SHIPPING:  { bg: "#fef08a", fg: "#713f12" }, // Vàng (Đang trung chuyển / Trên đường giao / Chuẩn bị vận chuyển)
  RETURNED:  { bg: "#e9d5ff", fg: "#581c87" }, // Tím (Trả hàng / Hoàn tiền / Giao không thành công)
  CANCELLED: { bg: "#fecaca", fg: "#7f1d1d" }, // Đỏ (Đã hủy / Lỗi cookie)
  DEFAULT:   { bg: "#f1f5f9", fg: "#334155" }  // Xám nhạt (Không có đơn hàng)
};

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu("📦 Kiểm Tra Đơn TikTok");
  menu.addItem("▶️ Chạy kiểm tra đơn ngay", "checkAllTikTokOrders");
  menu.addItem("📋 Tạo dòng tiêu đề chuẩn (Dòng 1)", "setupSheetHeaders");
  menu.addSeparator();
  menu.addItem("⏱️ Bật tự động kiểm tra mỗi 15 phút", "enable15MinTrigger");
  menu.addItem("⏱️ Bật tự động kiểm tra mỗi 30 phút", "enable30MinTrigger");
  menu.addItem("⏰ Bật tự động kiểm tra mỗi 1 tiếng", "enableHourlyTrigger");
  menu.addItem("🛑 Tắt tự động kiểm tra", "disableTriggers");
  menu.addToUi();
}

function setupSheetHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = [
    "cookie",
    "mvd",
    "đơn vị vận chuyển",
    "tên ng nhận",
    "sdt",
    "địa chỉ",
    "tiền cod",
    "trạng thái đơn hàng",
    "hành trình cuối đơn hàng",
    "thời gian đặt",
    "tên sản phẩm",
    "cập nhật lúc"
  ];
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#0f172a");
  headerRange.setFontColor("#ffffff");
  sheet.setFrozenRows(1);
}

function normalizeViText(str) {
  if (!str) return "";
  var s = String(str);
  s = s.replace(/Người nhận:\s*Customer\b/gi, "Người nhận: Khách hàng");
  s = s.replace(/Recipient:\s*Customer\b/gi, "Người nhận: Khách hàng");
  s = s.replace(/^Delivered$/i, "Đã giao");
  s = s.replace(/^In transit$/i, "Đang trung chuyển");
  s = s.replace(/^Out for delivery$/i, "Trên đường giao");
  s = s.replace(/^Order placed$/i, "Đã đặt đơn hàng");
  s = s.replace(/^To pay$/i, "Chờ thanh toán");
  s = s.replace(/^To ship$/i, "Chờ vận chuyển");
  s = s.replace(/^To receive$/i, "Chờ nhận");
  s = s.replace(/^Completed$/i, "Hoàn thành");
  s = s.replace(/^Cancell?ed$/i, "Đã hủy");
  s = s.replace(/\r?\n/g, " | ");
  return s.trim();
}

function formatViError(errMsg, statusCode) {
  var msg = String(errMsg || "").trim();
  var low = msg.toLowerCase();
  if (low.indexOf("missing sessionid") !== -1) {
    return "Thiếu cookie sessionid";
  }
  if (low.indexOf("login") !== -1 || low.indexOf("session") !== -1 || statusCode === 401 || statusCode === 403) {
    return "Cookie hết hạn hoặc không hợp lệ (" + msg + ")";
  }
  if (!msg && statusCode) {
    return "Mã phản hồi HTTP " + statusCode;
  }
  return msg;
}

function classifyOrderStatusStyle(order, trangThaiText, hanhTrinhText) {
  var code = Number(order.order_status_code || 0);
  var statusName = String(order.order_status_name || "").toLowerCase();
  var combined = (statusName + " " + trangThaiText + " " + hanhTrinhText).toLowerCase();

  // 1. Đơn hoàn / Trả hàng / Giao thất bại -> Màu Tím
  if (
    code === 8 ||
    combined.indexOf("trả hàng") !== -1 ||
    combined.indexOf("hoàn tiền") !== -1 ||
    combined.indexOf("hoàn hàng") !== -1 ||
    combined.indexOf("đơn hoàn") !== -1 ||
    combined.indexOf("chuyển hoàn") !== -1 ||
    combined.indexOf("hoàn") !== -1 ||
    combined.indexOf("giao không thành công") !== -1 ||
    combined.indexOf("giao hàng không thành công") !== -1 ||
    combined.indexOf("không giao được") !== -1 ||
    combined.indexOf("return") !== -1 ||
    combined.indexOf("refund") !== -1 ||
    combined.indexOf("unsuccessful") !== -1 ||
    combined.indexOf("delivery failed") !== -1
  ) {
    return STATUS_STYLES.RETURNED;
  }

  // 2. Đơn huỷ -> Màu Đỏ
  if (
    combined.indexOf("đã hủy") !== -1 ||
    combined.indexOf("đã huỷ") !== -1 ||
    combined.indexOf("hủy đơn") !== -1 ||
    combined.indexOf("huỷ đơn") !== -1 ||
    combined.indexOf("bị hủy") !== -1 ||
    combined.indexOf("bị huỷ") !== -1 ||
    combined.indexOf("cancel") !== -1
  ) {
    return STATUS_STYLES.CANCELLED;
  }

  // 3. Đơn giao thành công / Đã giao -> Màu Xanh lá
  if (
    code === 4 ||
    code === 5 ||
    statusName === "500" ||
    combined.indexOf("đã giao") !== -1 ||
    combined.indexOf("giao thành công") !== -1 ||
    combined.indexOf("hoàn thành") !== -1 ||
    combined.indexOf("chờ đánh giá") !== -1 ||
    statusName === "completed" ||
    combined.indexOf("delivered") !== -1
  ) {
    return STATUS_STYLES.DELIVERED;
  }

  // 4. Đơn đang giao / Đang trung chuyển / Chuẩn bị vận chuyển / Đã đặt -> Màu Vàng
  return STATUS_STYLES.SHIPPING;
}

function applyCellStyle(cell, style, bold) {
  cell.setBackground(style.bg);
  cell.setFontColor(style.fg);
  cell.setFontWeight(bold ? "bold" : "normal");
}

function checkAllTikTokOrders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log("Chưa có dữ liệu cookie ở dòng 2 trở đi.");
    return;
  }

  var cookieRange = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var nowStr = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm:ss");

  for (var i = 0; i < cookieRange.length; i++) {
    var rowIndex = i + 2;
    var rawCookie = String(cookieRange[i][0] || "").trim();
    if (!rawCookie) continue;

    var statusCell = sheet.getRange(rowIndex, 8); // Cột H (8): trạng thái đơn hàng

    try {
      var response = UrlFetchApp.fetch(API_URL, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ sessionid: rawCookie }),
        muteHttpExceptions: true
      });

      var statusCode = response.getResponseCode();
      var json = JSON.parse(response.getContentText() || "{}");

      if (statusCode !== 200 || !json.success) {
        var errMsg = formatViError(json.message || json.error, statusCode);
        sheet.getRange(rowIndex, 2, 1, 11).setValues([
          ["", "", "", "", "", "", "Lỗi: " + errMsg, "", "", "", nowStr]
        ]);
        applyCellStyle(statusCell, STATUS_STYLES.CANCELLED, true);
        continue;
      }

      var orders = json.orders || [];
      if (orders.length === 0) {
        var addrList = json.address_book || [];
        var addr = addrList.length > 0 ? addrList[0] : {};
        sheet.getRange(rowIndex, 2, 1, 11).setValues([
          [
            "Chưa có đơn",
            "",
            addr.recipient_name || "",
            addr.phone ? ("'" + addr.phone) : "",
            addr.address || "",
            "",
            "Không có đơn hàng",
            "",
            "",
            "",
            nowStr
          ]
        ]);
        applyCellStyle(statusCell, STATUS_STYLES.DEFAULT, false);
        continue;
      }

      var order = orders[0];
      var mvd = order.ma_van_don || (order.ma_kien_hang ? ("Kiện: " + order.ma_kien_hang) : "Chưa có MVĐ");
      var donViVanChuyen = order.don_vi_van_chuyen || "";
      var tenNguoiNhan = order.ten_nguoi_nhan || "";
      var sdt = order.so_dien_thoai ? ("'" + order.so_dien_thoai) : "";
      var diaChi = order.dia_chi || "";
      var tienCod = order.tien_cod_vnd || "";

      var statusTitle = normalizeViText(order.trang_thai_don_hang || order.order_status_title || "");
      var statusDetail = normalizeViText(order.chi_tiet_trang_thai || order.order_status_detail || "");
      var trangThaiParts = [];
      if (statusTitle) trangThaiParts.push(statusTitle);
      if (statusDetail && statusDetail !== statusTitle) trangThaiParts.push(statusDetail);
      var trangThai = trangThaiParts.join(" - ");

      var timeline = order.hanh_trinh_don_hang || [];
      var hanhTrinhCuoi = "";
      if (timeline.length > 0) {
        var latest = timeline[0];
        var parts = [];
        if (latest.thoi_gian) parts.push("[" + latest.thoi_gian + "]");
        var stepTitle = normalizeViText(latest.trang_thai || "");
        var stepDesc = normalizeViText(latest.mo_ta || "");
        if (stepTitle && stepDesc) {
          parts.push(stepTitle + " - " + stepDesc);
        } else if (stepTitle) {
          parts.push(stepTitle);
        } else if (stepDesc) {
          parts.push(stepDesc);
        }
        var buuTaTen = latest.buu_ta || order.ten_shipper || "";
        var buuTaSdt = latest.sdt_buu_ta || order.sdt_shipper || "";
        if (buuTaSdt) {
          parts.push("(Bưu tá: " + (buuTaTen ? (buuTaTen + " - ") : "") + buuTaSdt + ")");
        }
        hanhTrinhCuoi = parts.join(" ");
      }

      var thoiGianDat = order.ngay_gio_dat_don ? ("'" + order.ngay_gio_dat_don) : "";
      var rawProductName = String(order.ten_san_pham || "");
      var qtySuffix = " (x" + (order.so_luong || 1) + ")";
      var tenSanPham = /\(x\d+\)$/.test(rawProductName) ? rawProductName : (rawProductName + qtySuffix);

      sheet.getRange(rowIndex, 2, 1, 11).setValues([
        [
          "'" + mvd,
          donViVanChuyen,
          tenNguoiNhan,
          sdt,
          diaChi,
          tienCod,
          trangThai,
          hanhTrinhCuoi,
          thoiGianDat,
          tenSanPham,
          nowStr
        ]
      ]);

      var style = classifyOrderStatusStyle(order, trangThai, hanhTrinhCuoi);
      applyCellStyle(statusCell, style, true);

      Utilities.sleep(300);
    } catch (err) {
      sheet.getRange(rowIndex, 2, 1, 11).setValues([
        ["", "", "", "", "", "", "Lỗi kết nối: " + err.message, "", "", "", nowStr]
      ]);
      applyCellStyle(statusCell, STATUS_STYLES.CANCELLED, true);
    }
  }
}

function clearExistingTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "checkAllTikTokOrders") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function enable15MinTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 15 phút!");
}

function enable30MinTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyMinutes(30).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 30 phút!");
}

function enableHourlyTrigger() {
  clearExistingTriggers();
  ScriptApp.newTrigger("checkAllTikTokOrders").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("✅ Đã bật tự động kiểm tra đơn hàng TikTok mỗi 1 tiếng!");
}

function disableTriggers() {
  clearExistingTriggers();
  SpreadsheetApp.getUi().alert("🛑 Đã tắt tự động kiểm tra.");
}
