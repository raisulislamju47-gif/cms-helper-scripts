// ==UserScript==
// @name         CMS Live Class Table Cleaner + Live Form Validation
// @namespace    shikho-cms-helper
// @version      4.2
// @description  Improve CMS live class table and validate schedule inside Add/Edit form instantly
// @match        https://cms.shikho.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function isLiveClassPage() {
    return window.location.pathname.includes('/live-classes-academic');
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
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

    // Table format example:
    // 05:00 PM 16-05-2026
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

    // Form format example:
    // 2026-05-16 17:00:00
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
      if (text.includes('actions')) indexes.actions = index;
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
        <div style="
          font-size:12px;
          color:#555;
          margin-bottom:4px;
          font-weight:600;
        ">
          ${label}
        </div>

        <div style="
          font-size:20px;
          font-weight:800;
          color:${color};
          line-height:1.2;
        ">
          ${data.time}
        </div>

        <div style="
          font-size:12px;
          color:#333;
          margin-top:5px;
          font-weight:600;
        ">
          ${data.date}
        </div>
      </div>
    `;
  }

  function styleTextCell(cell, type) {
    if (!cell) return;

    const sourceText = cleanText(cell.innerText);

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
          ${sourceText || '-'}
        </div>
      `;
    }

    if (type === 'subject') {
      const lines = sourceText
        .split('\n')
        .map(line => cleanText(line))
        .filter(Boolean);

      cell.innerHTML = `
        <div style="
          line-height:1.5;
          max-width:360px;
        ">
          <div style="
            font-size:15px;
            font-weight:800;
            color:#222;
            margin-bottom:4px;
          ">
            ${lines[0] || '-'}
          </div>

          <div style="
            font-size:13px;
            color:#555;
            font-weight:600;
          ">
            ${lines.slice(1).join('<br>') || ''}
          </div>
        </div>
      `;
    }
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

  function improveOriginalTable() {
    if (!isLiveClassPage()) return;

    const tableWrapper = document.querySelector('.ant-table-wrapper');
    const tableBody = document.querySelector('.ant-table-tbody');

    if (!tableWrapper || !tableBody) return;

    const indexes = getColumnIndexes();

    if (
      indexes.title === undefined ||
      indexes.subjectChapter === undefined ||
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
      const startCell = cells[indexes.startTime];
      const endCell = cells[indexes.endTime];

      if (!startCell || !endCell) return;

      clearRowWarnings(row);

      const startSourceText = startCell.dataset.sourceText || startCell.innerText;
      const endSourceText = endCell.dataset.sourceText || endCell.innerText;

      const startData = parseCmsTableDateTime(startSourceText);
      const endData = parseCmsTableDateTime(endSourceText);

      styleTextCell(titleCell, 'title');
      styleTextCell(subjectCell, 'subject');

      styleTimeCell(startCell, 'Start', startData, '#354894', '#eef3ff');
      styleTimeCell(endCell, 'End', endData, '#CF278D', '#fff0f7');

      if (
        startData.time !== '-' &&
        endData.time !== '-' &&
        startData.rawDate === endData.rawDate &&
        startData.time === endData.time
      ) {
        addRowWarning(
          row,
          endCell,
          'Start time and end time are the same.',
          'warning'
        );
      }

      if (
        startData.rawDate !== '-' &&
        endData.rawDate !== '-' &&
        startData.rawDate !== endData.rawDate
      ) {
        addRowWarning(
          row,
          endCell,
          'Start date and end date are different. Please verify if this is intentional.',
          'warning'
        );
      }

      if (
        startData.dateTime &&
        endData.dateTime &&
        endData.dateTime < startData.dateTime
      ) {
        addRowWarning(
          row,
          endCell,
          'Invalid schedule: This class ends before it starts. Please recheck both date and time.',
          'danger'
        );

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

  function runCmsHelper() {
    if (!isLiveClassPage()) return;

    improveOriginalTable();
    validateLiveClassForm();
  }

  // Initial run
  setTimeout(runCmsHelper, 800);
  setTimeout(runCmsHelper, 1500);
  setTimeout(runCmsHelper, 2500);

  // Continuous check so it works after SPA/internal navigation
  setInterval(runCmsHelper, 1000);

  // Watch DOM updates
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

  // Watch input changes inside edit/add form
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

      setTimeout(refreshTable, 1000);
      setTimeout(refreshTable, 2500);
    }
  }, true);

  // Detect internal route changes in CMS SPA
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
