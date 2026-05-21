// ==UserScript==
// @name         CMS Live Class Table Cleaner + Live Form Validation
// @namespace    shikho-cms-helper
// @version      4.6
// @description  Improve CMS live class table, auto-update edited time, show teacher, and validate schedule
// @match        https://cms.shikho.com/*
// @updateURL    https://raw.githubusercontent.com/raisulislamju47-gif/cms-helper-scripts/main/cms-live-class-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/raisulislamju47gif/cms-helper-scripts/main/cms-live-class-helper.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let activeEditRow = null;

  function isLiveClassPage() {
    return window.location.pathname.includes('/live-classes-academic');
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatDate(dateText) {
    if (!dateText) return '-';

    const parts = dateText.split('-');
    if (parts.length !== 3) return dateText;

    const day = parts[0];
    const month = parts[1];
    const year = parts[2];

    const monthNames = {
      '01': 'January',
      '02': 'February',
      '03': 'March',
      '04': 'April',
      '05': 'May',
      '06': 'June',
      '07': 'July',
      '08': 'August',
      '09': 'September',
      '10': 'October',
      '11': 'November',
      '12': 'December'
    };

    const dateObj = new Date(`${year}-${month}-${day}`);
    const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

    return `${day} ${monthNames[month] || month} ${year}, ${weekday}`;
  }

  function convertToDateTime(timeText, dateText) {
    if (!timeText || !dateText || timeText === '-' || dateText === '-') return null;

    const dateParts = dateText.split('-');
    if (dateParts.length !== 3) return null;

    const day = Number(dateParts[0]);
    const month = Number(dateParts[1]) - 1;
    const year = Number(dateParts[2]);

    const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
    if (!timeMatch) return null;

    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const period = timeMatch[3].toUpperCase();

    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    return new Date(year, month, day, hour, minute);
  }

  function parseCmsTableDateTime(value) {
    const cleaned = cleanText(value);

    const match = cleaned.match(/(\d{1,2}:\d{2}\s?(AM|PM))\s+(\d{2}-\d{2}-\d{4})/i);

    if (!match) {
      return {
        time: cleaned || '-',
        date: '-',
        rawDate: '-',
        dateTime: null
      };
    }

    const time = match[1].toUpperCase();
    const rawDate = match[3];

    return {
      time,
      date: formatDate(rawDate),
      rawDate,
      dateTime: convertToDateTime(time, rawDate)
    };
  }

  function parseFormDateTime(value) {
    const cleaned = cleanText(value);

    const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);

    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);

    return new Date(year, month, day, hour, minute, second);
  }

  function formDateTimeToCmsText(value) {
    const dateObj = parseFormDateTime(value);
    if (!dateObj) return '';

    let hour = dateObj.getHours();
    const minute = dateObj.getMinutes();

    const period = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;

    const timeText = `${pad2(hour)}:${pad2(minute)} ${period}`;
    const dateText = `${pad2(dateObj.getDate())}-${pad2(dateObj.getMonth() + 1)}-${dateObj.getFullYear()}`;

    return `${timeText} ${dateText}`;
  }

  function formatFormDateTimeForMessage(dateObj) {
    if (!dateObj) return '-';

    return dateObj.toLocaleString('en-US', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  function getColumnIndexes() {
    const headers = Array.from(document.querySelectorAll('.ant-table-wrapper thead th'));
    const indexes = {};

    headers.forEach((header, index) => {
      const text = cleanText(header.innerText).toLowerCase();

      if (text === 'title') indexes.title = index;
      if (text.includes('subject')) indexes.subjectChapter = index;
      if (text.includes('class ongoing')) indexes.classOngoing = index;
      if (text.includes('start time')) indexes.startTime = index;
      if (text.includes('end time')) indexes.endTime = index;
      if (text.includes('teacher') || text.includes('mentor')) indexes.teacher = index;
      if (text.includes('actions')) indexes.actions = index;
      if (text.includes('class id')) indexes.classId = index;
    });

    return indexes;
  }

  function styleTimeCell(cell, label, data, color, bgColor) {
    if (!cell) return;

    const currentText = cleanText(cell.innerText);

    if (
      !cell.dataset.sourceText ||
      /(\d{1,2}:\d{2}\s?(AM|PM))\s+(\d{2}-\d{2}-\d{4})/i.test(currentText)
    ) {
      cell.dataset.sourceText = currentText;
    }

    const sourceKey = cell.dataset.sourceText || currentText;

    if (cell.dataset.renderedSource === sourceKey) return;

    cell.dataset.renderedSource = sourceKey;

    cell.innerHTML = `
      <div style="
        padding:10px 12px;
        border-radius:10px;
        background:${bgColor};
        min-width:180px;
      ">
        <div style="font-size:12px; color:#555; margin-bottom:4px; font-weight:600;">
          ${label}
        </div>

        <div style="font-size:20px; font-weight:800; color:${color}; line-height:1.2;">
          ${data.time}
        </div>

        <div style="font-size:12px; color:#333; margin-top:5px; font-weight:600;">
          ${data.date}
        </div>
      </div>
    `;
  }

  function styleTextCell(cell, type) {
    if (!cell) return;

    const rawText = cell.dataset.originalRawText || cell.innerText || '';

    if (!cell.dataset.originalRawText) {
      cell.dataset.originalRawText = rawText;
    }

    const sourceText = type === 'subject'
      ? cell.dataset.originalRawText
      : cleanText(cell.dataset.originalRawText);

    if (cell.dataset.renderedText === sourceText) return;

    cell.dataset.renderedText = sourceText;

    if (type === 'title') {
      cell.innerHTML = `
        <div style="
          font-size:17px;
          font-weight:800;
          color:#222;
          line-height:1.4;
          max-width:260px;
        ">
          ${cleanText(sourceText) || '-'}
        </div>
      `;
    }

    if (type === 'subject') {
      const lines = sourceText
        .split(/\n+/)
        .map(line => cleanText(line))
        .filter(Boolean);

      const subject = lines[0] || '-';
      const chapter = lines.slice(1).join('<br>') || '-';

      cell.innerHTML = `
        <div style="line-height:1.5; max-width:360px;">
          <div style="
            font-size:15px;
            font-weight:800;
            color:#222;
            margin-bottom:6px;
          ">
            ${subject}
          </div>

          <div style="
            font-size:13px;
            color:#555;
            font-weight:700;
          ">
            ${chapter}
          </div>
        </div>
      `;
    }
  }

  function styleClassOngoingCell(cell, classOngoingText, teacherName) {
    if (!cell) return;

    const sourceKey = `${classOngoingText}__${teacherName}`;

    if (cell.dataset.renderedSource === sourceKey) return;

    cell.dataset.renderedSource = sourceKey;

    cell.innerHTML = `
      <div style="line-height:1.5;">
        <div style="
          font-size:14px;
          font-weight:800;
          color:#222;
        ">
          ${classOngoingText || '-'}
        </div>

        <div style="
          margin-top:6px;
          padding:6px 8px;
          background:#f6f7fb;
          border:1px solid #e5e7eb;
          border-radius:8px;
          display:inline-block;
          font-size:12px;
          font-weight:700;
          color:#354894;
        ">
          Teacher: ${teacherName || '-'}
        </div>
      </div>
    `;
  }

  function clearRowWarnings(row) {
    if (!row) return;

    row.querySelectorAll('.cms-schedule-warning').forEach(warning => warning.remove());

    row.style.background = '';
    row.style.outline = '';
    row.style.outlineOffset = '';
  }

  function addRowWarning(row, targetCell, message, type = 'danger') {
    if (!row || !targetCell) return;

    if (row.querySelector(`[data-warning-message="${message}"]`)) return;

    const warning = document.createElement('div');
    warning.className = 'cms-schedule-warning';
    warning.setAttribute('data-warning-message', message);
    warning.innerHTML = `⚠ ${message}`;

    warning.style.marginTop = '8px';
    warning.style.padding = '8px 10px';
    warning.style.borderRadius = '8px';
    warning.style.fontSize = '13px';
    warning.style.fontWeight = '800';
    warning.style.lineHeight = '1.4';

    if (type === 'danger') {
      warning.style.background = '#ffecec';
      warning.style.border = '1px solid #ff4d4f';
      warning.style.color = '#b00020';
    } else {
      warning.style.background = '#fff3cd';
      warning.style.border = '1px solid #ffc107';
      warning.style.color = '#664d03';
    }

    targetCell.appendChild(warning);
  }

  function getTeacherNameFromRow(row, cells, indexes) {
  const classId = getClassIdFromRow(row, indexes);

  if (classId) {
    const cache = getTeacherCache();

    if (cache[classId]) {
      return cache[classId];
    }

    if (!row.dataset.teacherFetchStarted) {
      row.dataset.teacherFetchStarted = 'true';

      fetchTeacherNameByClassId(classId).then(teacherName => {
        if (teacherName) {
          row.dataset.teacherName = teacherName;
          setTimeout(improveOriginalTable, 100);
        }
      });
    }
  }

  if (row.dataset.teacherName) {
    return row.dataset.teacherName;
  }

  return '-';
}
  function getAuthTokenFromStorage() {
  const storageList = [localStorage, sessionStorage];

  for (const storage of storageList) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const value = storage.getItem(key) || '';

      // Look for JWT-like token
      const match = value.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);

      if (match) {
        return match[0];
      }
    }
  }

  return '';
}

function getTeacherCache() {
  try {
    return JSON.parse(localStorage.getItem('cmsTeacherCache') || '{}');
  } catch (e) {
    return {};
  }
}

function saveTeacherCache(cache) {
  localStorage.setItem('cmsTeacherCache', JSON.stringify(cache));
}

function getClassIdFromRow(row, indexes) {
  const cells = Array.from(row.querySelectorAll('td'));

  if (indexes.classId !== undefined && cells[indexes.classId]) {
    return cleanText(cells[indexes.classId].innerText);
  }

  return '';
}

async function fetchTeacherNameByClassId(classId) {
  if (!classId) return '';

  const cache = getTeacherCache();

  if (cache[classId]) {
    return cache[classId];
  }

  const token = getAuthTokenFromStorage();

  if (!token) {
    console.warn('[CMS Helper] Auth token not found. Teacher name cannot be fetched.');
    return '';
  }

  const query = `
    query LiveClassAcademic($id: String!) {
      academicProgramLiveClass(id: $id) {
        id
        teacher {
          id
          name
        }
      }
    }
  `;

  try {
    const response = await fetch('https://api.shikho.com/graphql', {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'x-vendor': 'shikho'
      },
      body: JSON.stringify({
        operationName: 'LiveClassAcademic',
        variables: {
          id: classId
        },
        query
      })
    });

    const result = await response.json();

    const teacherName =
      result?.data?.academicProgramLiveClass?.teacher?.name || '';

    if (teacherName) {
      cache[classId] = teacherName;
      saveTeacherCache(cache);
    }

    return teacherName;
  } catch (error) {
    console.warn('[CMS Helper] Failed to fetch teacher name:', error);
    return '';
  }
}
  
  function improveOriginalTable() {
    if (!isLiveClassPage()) return;

    const tableWrapper = document.querySelector('.ant-table-wrapper');
    const tableBody = document.querySelector('.ant-table-tbody');

    if (!tableWrapper || !tableBody) return;

    const indexes = getColumnIndexes();

    if (
      indexes.title === undefined ||
      indexes.subjectChapter === undefined ||
      indexes.classOngoing === undefined ||
      indexes.startTime === undefined ||
      indexes.endTime === undefined
    ) {
      return;
    }

    const rows = Array.from(tableBody.querySelectorAll('tr.ant-table-row'));

    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) return;

      const titleCell = cells[indexes.title];
      const subjectCell = cells[indexes.subjectChapter];
      const classOngoingCell = cells[indexes.classOngoing];
      const startCell = cells[indexes.startTime];
      const endCell = cells[indexes.endTime];

      if (!startCell || !endCell) return;

      clearRowWarnings(row);

      const startSourceText = startCell.dataset.sourceText || startCell.innerText;
      const endSourceText = endCell.dataset.sourceText || endCell.innerText;

      const startData = parseCmsTableDateTime(startSourceText);
      const endData = parseCmsTableDateTime(endSourceText);

      const classOngoingText =
        classOngoingCell.dataset.originalClassOngoingText ||
        cleanText(classOngoingCell.innerText);

      if (!classOngoingCell.dataset.originalClassOngoingText) {
        classOngoingCell.dataset.originalClassOngoingText = classOngoingText;
      }

      const teacherName = getTeacherNameFromRow(row, cells, indexes);
      
      styleTextCell(titleCell, 'title');
      styleTextCell(subjectCell, 'subject');
      styleClassOngoingCell(classOngoingCell, classOngoingText, teacherName);

      styleTimeCell(startCell, 'Start', startData, '#354894', '#eef3ff');
      styleTimeCell(endCell, 'End', endData, '#CF278D', '#fff0f7');

      if (
        startData.time !== '-' &&
        endData.time !== '-' &&
        startData.rawDate === endData.rawDate &&
        startData.time === endData.time
      ) {
        addRowWarning(row, endCell, 'Start time and end time are the same.', 'warning');
      }

      if (
        startData.rawDate !== '-' &&
        endData.rawDate !== '-' &&
        startData.rawDate !== endData.rawDate
      ) {
        addRowWarning(row, endCell, 'Start date and end date are different. Please verify if this is intentional.', 'warning');
      }

      if (
        startData.dateTime &&
        endData.dateTime &&
        endData.dateTime < startData.dateTime
      ) {
        addRowWarning(row, endCell, 'Invalid schedule: This class ends before it starts. Please recheck both date and time.', 'danger');

        row.style.background = '#fff5f5';
        row.style.outline = '2px solid #ff4d4f';
        row.style.outlineOffset = '-2px';
      }
    });

    const table = tableWrapper.querySelector('table');
    if (table) {
      table.style.fontFamily = 'Arial, sans-serif';
    }

    const headerCells = tableWrapper.querySelectorAll('thead th');
    headerCells.forEach(th => {
      th.style.fontWeight = '800';
      th.style.color = '#222';
      th.style.background = '#f8f8fb';
      th.style.fontSize = '13px';
    });
  }

  function findFormItemByLabel(labelText) {
    const formItems = Array.from(document.querySelectorAll('.ant-form-item'));

    return formItems.find(item => {
      const label = item.querySelector('.ant-form-item-label label');
      const text = cleanText(label?.innerText).toLowerCase();

      return text.includes(labelText.toLowerCase());
    });
  }

  function getInputValueFromFormItem(formItem) {
    if (!formItem) return '';

    const input = formItem.querySelector('input');
    return cleanText(input?.value);
  }

  function removeFormWarning() {
    document.querySelectorAll('.cms-live-form-warning').forEach(el => el.remove());
  }

  function showFormWarning(targetFormItem, message, type = 'danger') {
    if (!targetFormItem) return;

    removeFormWarning();

    const warning = document.createElement('div');
    warning.className = 'cms-live-form-warning';
    warning.innerHTML = `⚠ ${message}`;

    warning.style.marginTop = '8px';
    warning.style.padding = '12px 14px';
    warning.style.borderRadius = '8px';
    warning.style.fontSize = '14px';
    warning.style.fontWeight = '800';
    warning.style.lineHeight = '1.5';

    if (type === 'danger') {
      warning.style.background = '#ffecec';
      warning.style.border = '1px solid #ff4d4f';
      warning.style.color = '#b00020';
    } else {
      warning.style.background = '#fff3cd';
      warning.style.border = '1px solid #ffc107';
      warning.style.color = '#664d03';
    }

    targetFormItem.appendChild(warning);
  }

  function validateLiveClassForm() {
    if (!isLiveClassPage()) return true;

    const drawerOrModal = document.querySelector('.ant-drawer-content, .ant-modal-content');

    if (!drawerOrModal) {
      removeFormWarning();
      return true;
    }

    const drawerText = cleanText(drawerOrModal.innerText).toLowerCase();

    const isLiveClassForm =
      drawerText.includes('edit live class') ||
      drawerText.includes('add live class') ||
      drawerText.includes('live class title');

    if (!isLiveClassForm) {
      removeFormWarning();
      return true;
    }

    const startItem = findFormItemByLabel('start time');
    const endItem = findFormItemByLabel('end time');

    if (!startItem || !endItem) {
      removeFormWarning();
      return true;
    }

    const startValue = getInputValueFromFormItem(startItem);
    const endValue = getInputValueFromFormItem(endItem);

    const startDateTime = parseFormDateTime(startValue);
    const endDateTime = parseFormDateTime(endValue);

    if (!startDateTime || !endDateTime) {
      removeFormWarning();
      return true;
    }

    if (endDateTime < startDateTime) {
      showFormWarning(
        endItem,
        `
          Invalid schedule: This class ends before it starts.<br>
          Start: ${formatFormDateTimeForMessage(startDateTime)}<br>
          End: ${formatFormDateTimeForMessage(endDateTime)}<br>
          Please recheck both date and time before submitting.
        `,
        'danger'
      );

      return false;
    }

    if (endDateTime.getTime() === startDateTime.getTime()) {
      showFormWarning(
        endItem,
        `
          Schedule warning: Start time and end time are the same.<br>
          Start/End: ${formatFormDateTimeForMessage(startDateTime)}
        `,
        'warning'
      );

      return false;
    }

    removeFormWarning();
    return true;
  }

  function updateActiveRowFromForm() {
    if (!activeEditRow) return;

    const startItem = findFormItemByLabel('start time');
    const endItem = findFormItemByLabel('end time');

    const startValue = getInputValueFromFormItem(startItem);
    const endValue = getInputValueFromFormItem(endItem);

    const startCmsText = formDateTimeToCmsText(startValue);
    const endCmsText = formDateTimeToCmsText(endValue);

    if (!startCmsText || !endCmsText) return;

    const indexes = getColumnIndexes();
    const cells = Array.from(activeEditRow.querySelectorAll('td'));

    const startCell = cells[indexes.startTime];
    const endCell = cells[indexes.endTime];

    if (startCell) {
      startCell.dataset.sourceText = startCmsText;
      startCell.dataset.renderedSource = '';
    }

    if (endCell) {
      endCell.dataset.sourceText = endCmsText;
      endCell.dataset.renderedSource = '';
    }

    setTimeout(improveOriginalTable, 100);
    setTimeout(improveOriginalTable, 500);
    setTimeout(improveOriginalTable, 1200);
  }

  function runCmsHelper() {
    if (!isLiveClassPage()) return;

    improveOriginalTable();
    validateLiveClassForm();
  }

  let tableTimer;
  function refreshTable(delay = 300) {
    clearTimeout(tableTimer);
    tableTimer = setTimeout(improveOriginalTable, delay);
  }

  let formTimer;
  function refreshFormValidation(delay = 150) {
    clearTimeout(formTimer);
    formTimer = setTimeout(validateLiveClassForm, delay);
  }

  setTimeout(runCmsHelper, 800);
  setTimeout(runCmsHelper, 1500);
  setTimeout(runCmsHelper, 2500);

  setInterval(runCmsHelper, 1000);

  const observer = new MutationObserver(() => {
    if (!isLiveClassPage()) return;

    refreshTable(300);
    refreshFormValidation(150);
  });

  setTimeout(() => {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['value', 'class', 'style']
    });
  }, 1500);

  document.addEventListener('input', function () {
    if (!isLiveClassPage()) return;
    refreshFormValidation(50);
  }, true);

  document.addEventListener('change', function () {
    if (!isLiveClassPage()) return;
    refreshFormValidation(50);
  }, true);

  document.addEventListener('click', function (event) {
    if (!isLiveClassPage()) return;

    const clickedRow = event.target.closest('tr.ant-table-row');
    const clickedButtonOrIcon = event.target.closest('button, a, span, svg');

    if (clickedRow && clickedButtonOrIcon) {
      const rowText = cleanText(clickedRow.innerText).toLowerCase();
      const clickedText = cleanText(clickedButtonOrIcon.innerText).toLowerCase();
      const clickedClass = String(clickedButtonOrIcon.className || '').toLowerCase();

      if (
        clickedText.includes('edit') ||
        clickedClass.includes('edit') ||
        rowText
      ) {
        activeEditRow = clickedRow;
      }
    }

    setTimeout(validateLiveClassForm, 100);
    setTimeout(validateLiveClassForm, 300);

    const button = event.target.closest('button');
    if (!button) return;

    const text = cleanText(button.innerText).toLowerCase();

    const isSubmitLike =
      text.includes('submit') ||
      text.includes('save') ||
      text.includes('update') ||
      text === 'ok';

    if (isSubmitLike) {
      validateLiveClassForm();

      setTimeout(updateActiveRowFromForm, 300);
      setTimeout(updateActiveRowFromForm, 800);
      setTimeout(refreshTable, 1200);
      setTimeout(refreshTable, 2500);
    }
  }, true);

  let lastUrl = location.href;

  function watchRouteChange() {
    const currentUrl = location.href;

    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;

      setTimeout(runCmsHelper, 500);
      setTimeout(runCmsHelper, 1000);
      setTimeout(runCmsHelper, 2000);
      setTimeout(runCmsHelper, 3000);
    }
  }

  setInterval(watchRouteChange, 500);
})();
