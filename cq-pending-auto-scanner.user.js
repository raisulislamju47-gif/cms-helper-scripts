// ==UserScript==
// @name         Shikho CQ Pending Auto Scanner Dashboard
// @namespace    https://cqchecker.shikho.com/
// @version      3.0.6
// @description  Auto-scan CQ exams and show pending answer scripts without manually clicking every question
// @author       Raisul Islam
// @match        *://cqchecker.shikho.com/*
// @match        *://www.cqchecker.shikho.com/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @updateURL    https://raw.githubusercontent.com/raisulislamju47-gif/cms-helper-scripts/main/cq-pending-auto-scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/raisulislamju47-gif/cms-helper-scripts/main/cq-pending-auto-scanner.user.js
// ==/UserScript==

(function () {
  "use strict";

  /************************************************************
   * CONFIG
   ************************************************************/
  const GRAPHQL_URL = "https://api.shikho.com/graphql";
  const BRAND_BLUE = "#354894";
  const BRAND_PINK = "#cf278d";

  const STORAGE = {
    subjects: "shikho_cq_auto_subjects_v3",
    exams: "shikho_cq_auto_exams_v3",
    questionCache: "shikho_cq_auto_question_cache_v3",
    hideZero: "shikho_cq_auto_hide_zero_v3",
    scope: "shikho_cq_auto_scope_v3",
  };

  let authHeader = "";
  let isReady = false;
  let stopScan = false;
  
  let latestScanRows = [];
  let latestScanSummary = {
    totalPending: 0,
    scannedQuestions: 0,
    pendingExams: 0,
    errorCount: 0,
    generatedAt: "",
  };

  /************************************************************
   * GRAPHQL QUERIES
   ************************************************************/
  const QUERIES = {
    profile: `
      query Profile($type: String!) {
        profile(type: $type) {
          id
          first_name
          subjects_taken {
            code
            display
            group
            parent_code
            __typename
          }
          __typename
        }
      }
    `,

    modelTests: `
      query ModelTestListForCheckerPortal(
        $subject_ids: [String],
        $class_id: String,
        $exam_type: String,
        $is_published: Boolean,
        $title: String
      ) {
        modelTestListCheckerPortal(
          class_id: $class_id
          exam_type: $exam_type
          is_published: $is_published
          subject_ids: $subject_ids
          title: $title
        ) {
          data {
            id
            class
            title
            group
            stages {
              id
              no_of_questions
              serial
              title
              type
              __typename
            }
            subjects {
              code
              display
              display_bn
              __typename
            }
            __typename
          }
          __typename
        }
      }
    `,

    cqExam: `
      query CQExam($stage_id: String!) {
        cqExam(id: $stage_id) {
          checkers_deadline
          id
          is_active
          no_of_sets
          number_of_question
          number_of_question_to_answer
          title
          __typename
        }
      }
    `,

    questionList: `
      query QuestionBankListByQuestionBankByCqRelation(
        $limit: Int,
        $page: Int,
        $question_set: String,
        $session_id: String
      ) {
        questionBankListByQuestionBankByCqRelation(
          limit: $limit
          page: $page
          question_set: $question_set
          session_id: $session_id
        ) {
          data {
            id
            question_no
            title
            total_marks
            unchecked_answer_sheet
            __typename
          }
          meta {
            count
            cursor
            __typename
          }
          __typename
        }
      }
    `,

    pendingCount: `
      query UnansweredAnsCountQuery(
        $exam_id: String!,
        $model_test_id: String!,
        $question_id: String!,
        $set_identifier: String!
      ) {
        getUnansweredAnswerSheetCount(
          exam_id: $exam_id
          model_test_id: $model_test_id
          question_id: $question_id
          set_identifier: $set_identifier
        ) {
          count
          __typename
        }
      }
    `,
  };

  /************************************************************
   * HELPERS
   ************************************************************/
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseJson(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

 function readStore(key, fallback = []) {
  const parsed = parseJson(localStorage.getItem(key), fallback);
  return parsed === null || parsed === undefined ? fallback : parsed;
}

  function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(message) {
    const el = document.querySelector("#cq-auto-status");
    if (el) el.textContent = message;
  }

  function setProgress(current, total) {
    const bar = document.querySelector("#cq-auto-progress-bar");
    const text = document.querySelector("#cq-auto-progress-text");

    const percent = total ? Math.round((current / total) * 100) : 0;

    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${current}/${total} scanned`;
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function makeExamKey(exam) {
    return `${exam.model_test_id}|${exam.exam_id}`;
  }

  function makeQuestionCacheKey(examId, setId) {
    return `${examId}|${setId}`;
  }

  function mergeUnique(existing, incoming, keyFn) {
    const map = new Map();

    for (const item of existing || []) {
      map.set(keyFn(item), item);
    }

    for (const item of incoming || []) {
      const key = keyFn(item);
      map.set(key, { ...(map.get(key) || {}), ...item });
    }

    return Array.from(map.values());
  }

  function setLetters(count) {
    const letters = [];
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for (let i = 0; i < Number(count || 1); i++) {
      letters.push(alphabet[i] || String(i + 1));
    }

    return letters;
  }

  function getAuthFromStorage() {
    const stores = [localStorage, sessionStorage];

    for (const store of stores) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const value = store.getItem(key);

        if (!value) continue;

        if (value.startsWith("Bearer ")) return value;

        if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value)) {
          return `Bearer ${value}`;
        }

        const json = parseJson(value, null);

        if (json && typeof json === "object") {
          const candidates = [
            json.token,
            json.accessToken,
            json.access_token,
            json.idToken,
            json.jwt,
          ];

          for (const candidate of candidates) {
            if (!candidate) continue;

            const text = String(candidate);

            if (text.startsWith("Bearer ")) return text;

            if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(text)) {
              return `Bearer ${text}`;
            }
          }
        }
      }
    }

    return "";
  }

  function getAuthHeader() {
    return authHeader || getAuthFromStorage();
  }

  async function gql(operationName, variables, query) {
    const token = getAuthHeader();

    if (!token) {
      throw new Error("Authorization token not found. Reload the portal and try again.");
    }

    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        authorization: token,
      },
      body: JSON.stringify({
        operationName,
        variables,
        query,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors?.length) {
      throw new Error(data.errors.map((e) => e.message).join(", "));
    }

    return data;
  }

  /************************************************************
   * CAPTURE AUTH FROM EXISTING PORTAL REQUESTS
   ************************************************************/
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const [resource, config] = args;

    try {
      const url = typeof resource === "string" ? resource : resource?.url;

      if (url?.includes("/graphql") && config?.headers) {
        const headers = new Headers(config.headers);
        const auth = headers.get("authorization");

        if (auth?.startsWith("Bearer ")) {
          authHeader = auth;
        }
      }
    } catch (error) {
      console.warn("[CQ Auto Scanner] Auth capture failed", error);
    }

    return originalFetch.apply(this, args);
  };

  /************************************************************
   * API LOGIC
   ************************************************************/
  async function loadSubjects() {
    setStatus("Loading subjects...");

    const data = await gql("Profile", { type: "cq_checker" }, QUERIES.profile);
    const subjects = data?.data?.profile?.subjects_taken || [];

    const cleaned = subjects.map((subject) => ({
      code: subject.code,
      display: normalizeText(subject.display),
      group: subject.group || "",
      parent_code: subject.parent_code || "",
    }));

    writeStore(STORAGE.subjects, cleaned);

    setStatus(`Loaded ${cleaned.length} subject(s).`);
    renderDashboard();

    return cleaned;
  }

  async function discoverExams() {
    let subjects = readStore(STORAGE.subjects, []);

    if (!subjects.length) {
      subjects = await loadSubjects();
    }

    const scope = document.querySelector("#cq-auto-scope")?.value || "HSC";
    localStorage.setItem(STORAGE.scope, scope);

    const selectedSubjects =
      scope === "ALL"
        ? subjects
        : subjects.filter((subject) => subject.parent_code === scope);

    if (!selectedSubjects.length) {
      setStatus(`No subject found for ${scope}.`);
      return [];
    }

    setStatus(`Discovering exams from ${selectedSubjects.length} subject(s)...`);

    let discovered = [];
    let done = 0;

    for (const subject of selectedSubjects) {
      if (stopScan) break;

      try {
        const data = await gql(
          "ModelTestListForCheckerPortal",
          {
            subject_ids: [subject.code],
            is_published: true,
          },
          QUERIES.modelTests
        );

        const modelTests = data?.data?.modelTestListCheckerPortal?.data || [];

        for (const modelTest of modelTests) {
          const subjectText = (modelTest.subjects || [])
            .map((item) => normalizeText(item.display))
            .filter(Boolean)
            .join(", ");

          for (const stage of modelTest.stages || []) {
            if (stage.type !== "CQ") continue;

            discovered.push({
              model_test_id: modelTest.id,
              model_test_title: normalizeText(modelTest.title),
              class: modelTest.class || "",
              group: modelTest.group || "",
              subject: subjectText || subject.display,
              subject_code: subject.code,
              subject_parent_code: subject.parent_code,
              exam_id: stage.id,
              exam_title: normalizeText(stage.title),
              no_of_questions: Number(stage.no_of_questions || 0),
              no_of_sets: null,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        console.warn("[CQ Auto Scanner] Failed to discover subject:", subject, error);
      }

      done++;
      setStatus(`Discovering exams... ${done}/${selectedSubjects.length}`);
      await sleep(120);
    }

    const oldExams = readStore(STORAGE.exams, []);
    const merged = mergeUnique(oldExams, discovered, makeExamKey);

    writeStore(STORAGE.exams, merged);

    setStatus(`Discovered ${discovered.length} CQ exam(s). Total cache: ${merged.length}.`);
    renderDashboard();

    return merged;
  }

  async function getExamDetails(exam) {
    try {
      const data = await gql(
        "CQExam",
        { stage_id: exam.exam_id },
        QUERIES.cqExam
      );

      const cqExam = data?.data?.cqExam;

      if (!cqExam) return exam;

      return {
        ...exam,
        no_of_sets: Number(cqExam.no_of_sets || exam.no_of_sets || 1),
        no_of_questions: Number(cqExam.number_of_question || exam.no_of_questions || 0),
        exam_title: normalizeText(cqExam.title || exam.exam_title),
        is_active: Boolean(cqExam.is_active),
      };
    } catch (error) {
      console.warn("[CQ Auto Scanner] CQExam failed:", exam, error);
      return {
        ...exam,
        no_of_sets: Number(exam.no_of_sets || 1),
      };
    }
  }

  async function getQuestionsForExamSet(exam, setId) {
    const cache = readStore(STORAGE.questionCache, {});
    const cacheKey = makeQuestionCacheKey(exam.exam_id, setId);

    if (cache[cacheKey]?.length) {
      return cache[cacheKey];
    }

    const data = await gql(
      "QuestionBankListByQuestionBankByCqRelation",
      {
        limit: 100,
        page: 1,
        question_set: setId,
        session_id: exam.exam_id,
      },
      QUERIES.questionList
    );

    const questions =
      data?.data?.questionBankListByQuestionBankByCqRelation?.data || [];

    const cleaned = questions.map((question, index) => ({
      question_id: question.id,
      question_label: question.question_no
        ? normalizeText(question.question_no)
        : `Q${index + 1}`,
      title_preview: normalizeText(question.title || "").slice(0, 90),
      total_marks: question.total_marks ?? "",
    }));

    cache[cacheKey] = cleaned;
    writeStore(STORAGE.questionCache, cache);

    return cleaned;
  }

  async function getPendingCount({ exam, setId, question }) {
    const data = await gql(
      "UnansweredAnsCountQuery",
      {
        exam_id: exam.exam_id,
        model_test_id: exam.model_test_id,
        question_id: question.question_id,
        set_identifier: setId,
      },
      QUERIES.pendingCount
    );

    return Number(data?.data?.getUnansweredAnswerSheetCount?.count || 0);
  }

  /************************************************************
   * MAIN SCAN
   ************************************************************/
  async function scanPending() {
    stopScan = false;

    const resultBox = document.querySelector("#cq-auto-results");
    if (!resultBox) return;

    const pendingExams = rows.filter((row) => row.totalPending > 0).length;
    const errorCount = rows.reduce(
      (sum, row) => sum + row.questionRows.filter((q) => q.type === "error").length,
      0
    );
    
    latestScanRows = rows;
    latestScanSummary = {
      totalPending,
      scannedQuestions,
      pendingExams,
      errorCount,
      generatedAt: new Date().toLocaleString(),
    };

    resultBox.innerHTML = `<div class="cq-auto-empty">Starting scan...</div>`;

    let exams = readStore(STORAGE.exams, []);

    const scope = document.querySelector("#cq-auto-scope")?.value || "HSC";
    localStorage.setItem(STORAGE.scope, scope);

    if (!exams.length) {
      exams = await discoverExams();
    }

    const scopedExams =
      scope === "ALL"
        ? exams
        : exams.filter((exam) => exam.subject_parent_code === scope || exam.class === scope);

    if (!scopedExams.length) {
      resultBox.innerHTML = `<div class="cq-auto-empty">No discovered CQ exam found for ${escapeHtml(scope)}.</div>`;
      setStatus("No exam found.");
      return;
    }

    const scanLimitValue = Number(document.querySelector("#cq-auto-limit")?.value || 0);
    const examsToScan = scanLimitValue > 0 ? scopedExams.slice(0, scanLimitValue) : scopedExams;

    let rows = [];
    let totalPending = 0;
    let scannedQuestions = 0;

    setProgress(0, examsToScan.length);

    for (let examIndex = 0; examIndex < examsToScan.length; examIndex++) {
      if (stopScan) {
        setStatus("Scan stopped.");
        break;
      }

      let exam = examsToScan[examIndex];

      setStatus(`Scanning exam ${examIndex + 1}/${examsToScan.length}: ${exam.model_test_title}`);

      exam = await getExamDetails(exam);

      const setIds = setLetters(exam.no_of_sets || 1);
      let examTotalPending = 0;
      let examQuestionRows = [];

      for (const setId of setIds) {
        if (stopScan) break;

        let questions = [];

        try {
          questions = await getQuestionsForExamSet(exam, setId);
        } catch (error) {
          examQuestionRows.push({
            type: "error",
            message: `Question list failed for Set ${setId}: ${error.message}`,
          });
          continue;
        }

        for (const question of questions) {
          if (stopScan) break;

          try {
            const count = await getPendingCount({ exam, setId, question });
            scannedQuestions++;
            examTotalPending += count;
            totalPending += count;

            examQuestionRows.push({
              type: "question",
              setId,
              question,
              count,
            });
          } catch (error) {
            examQuestionRows.push({
              type: "error",
              setId,
              question,
              message: error.message,
            });
          }

          setStatus(
            `Scanning: ${examIndex + 1}/${examsToScan.length} exams • ${scannedQuestions} questions checked`
          );

          await sleep(90);
        }

        await sleep(120);
      }

      rows.push({
        exam,
        totalPending: examTotalPending,
        questionRows: examQuestionRows,
      });

      setProgress(examIndex + 1, examsToScan.length);
      renderResults(rows, totalPending, scannedQuestions);
      await sleep(150);
    }

    renderResults(rows, totalPending, scannedQuestions);
    setStatus(
      stopScan
        ? `Scan stopped. Pending found: ${totalPending}`
        : `Scan completed. Pending found: ${totalPending}`
    );
  }

  function renderResults(rows, totalPending, scannedQuestions) {
    const resultBox = document.querySelector("#cq-auto-results");
    if (!resultBox) return;

    const hideZero = localStorage.getItem(STORAGE.hideZero) !== "false";

    const visibleRows = hideZero
      ? rows.filter((row) => row.totalPending > 0 || row.questionRows.some((q) => q.type === "error"))
      : rows;

   
    const summaryHtml = `
      <div class="cq-auto-summary">
        <div><span>Total Pending</span><strong>${totalPending}</strong></div>
        <div><span>Pending Exams</span><strong>${pendingExams}</strong></div>
        <div><span>Questions Checked</span><strong>${scannedQuestions}</strong></div>
        <div><span>Errors</span><strong>${errorCount}</strong></div>
      </div>
    `;

    if (!visibleRows.length) {
      resultBox.innerHTML =
        summaryHtml +
        `<div class="cq-auto-good">No pending scripts found in scanned exams.</div>`;
      return;
    }

    resultBox.innerHTML =
      summaryHtml +
      visibleRows
        .sort((a, b) => b.totalPending - a.totalPending)
        .map((row, index) => examRowHtml(row, index))
        .join("");

    bindResultButtons();
  }

  function examRowHtml(row, index) {
    const { exam, totalPending, questionRows } = row;

    const pendingQuestionRows = questionRows.filter(
      (item) => item.type === "question" && Number(item.count) > 0
    );

    const errorRows = questionRows.filter((item) => item.type === "error");

    const detailRows = [...pendingQuestionRows, ...errorRows];

    return `
      <div class="cq-auto-exam ${totalPending > 0 ? "has-pending" : "done"}">
        <div class="cq-auto-exam-top">
          <div>
            <div class="cq-auto-exam-title">${escapeHtml(exam.model_test_title)}</div>
            <div class="cq-auto-meta">
              ${escapeHtml(exam.subject || "Subject")} • ${escapeHtml(exam.class || "")}
              ${exam.group ? " • " + escapeHtml(exam.group) : ""}
            </div>
            <div class="cq-auto-meta">
              ${escapeHtml(exam.exam_title || "CQ Exam")} • Sets: ${escapeHtml(exam.no_of_sets || 1)}
            </div>
          </div>
          <div class="cq-auto-pending-count">${totalPending}</div>
        </div>

        ${
          detailRows.length
            ? `
              <button class="cq-auto-details-btn" data-detail="${index}">
                Show details
              </button>

              <div class="cq-auto-details" id="cq-auto-details-${index}" style="display:none;">
                ${
                  detailRows
                    .map((item) => {
                      if (item.type === "error") {
                        return `
                          <div class="cq-auto-question-row error">
                            <div>
                              <strong>Error</strong>
                              <span>${escapeHtml(item.message)}</span>
                            </div>
                            <b>!</b>
                          </div>
                        `;
                      }

                      return `
                        <div class="cq-auto-question-row">
                          <div>
                            <strong>Set ${escapeHtml(item.setId)} • ${escapeHtml(item.question.question_label)}</strong>
                            <span>${escapeHtml(item.question.title_preview)}</span>
                          </div>
                          <b>${Number(item.count || 0)}</b>
                        </div>
                      `;
                    })
                    .join("")
                }
              </div>
            `
            : `<div class="cq-auto-no-detail">No pending question in this exam.</div>`
        }
      </div>
    `;
  }

  function bindResultButtons() {
    document.querySelectorAll(".cq-auto-details-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const index = button.getAttribute("data-detail");
        const detail = document.querySelector(`#cq-auto-details-${index}`);

        if (!detail) return;

        const isHidden = detail.style.display === "none";
        detail.style.display = isHidden ? "block" : "none";
        button.textContent = isHidden ? "Hide details" : "Show details";
      });
    });
  }

  function stopCurrentScan() {
    stopScan = true;
    setStatus("Stopping scan...");
  }

  function clearExamCache() {
    if (!confirm("Clear discovered exams and question cache?")) return;

    writeStore(STORAGE.exams, []);
    writeStore(STORAGE.questionCache, {});
    renderDashboard();
    setStatus("Exam and question cache cleared.");
  }

  function exportVisibleResults() {
  if (!latestScanRows.length) {
    alert("No scan result found yet. Please run Scan Pending first.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("XLSX library not loaded. Please check the @require line in Tampermonkey header.");
    return;
  }

  const hideZero = localStorage.getItem(STORAGE.hideZero) !== "false";

  const rowsToExport = hideZero
    ? latestScanRows.filter(
        (row) =>
          row.totalPending > 0 ||
          row.questionRows.some((q) => q.type === "error")
      )
    : latestScanRows;

  const summaryData = [
    ["Generated At", latestScanSummary.generatedAt],
    ["Total Pending", latestScanSummary.totalPending],
    ["Pending Exams", latestScanSummary.pendingExams],
    ["Questions Checked", latestScanSummary.scannedQuestions],
    ["Errors", latestScanSummary.errorCount],
  ];

  const detailData = [
    [
      "Exam Title",
      "Subject",
      "Class",
      "Group",
      "Exam / Stage",
      "Set",
      "Question",
      "Question Title / Preview",
      "Pending Count",
      "Status",
    ],
  ];

  for (const row of rowsToExport) {
    const exam = row.exam;

    const pendingQuestions = row.questionRows.filter(
      (item) => item.type === "question" && Number(item.count) > 0
    );

    const errorQuestions = row.questionRows.filter((item) => item.type === "error");

    if (!pendingQuestions.length && !errorQuestions.length && !hideZero) {
      detailData.push([
        exam.model_test_title || "",
        exam.subject || "",
        exam.class || "",
        exam.group || "",
        exam.exam_title || "",
        "",
        "",
        "",
        0,
        "No Pending",
      ]);
    }

    for (const item of pendingQuestions) {
      detailData.push([
        exam.model_test_title || "",
        exam.subject || "",
        exam.class || "",
        exam.group || "",
        exam.exam_title || "",
        item.setId || "",
        item.question?.question_label || "",
        item.question?.title_preview || "",
        Number(item.count || 0),
        "Pending",
      ]);
    }

    for (const item of errorQuestions) {
      detailData.push([
        exam.model_test_title || "",
        exam.subject || "",
        exam.class || "",
        exam.group || "",
        exam.exam_title || "",
        item.setId || "",
        item.question?.question_label || "",
        item.message || "",
        "",
        "Error",
      ]);
    }
  }

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  const detailSheet = XLSX.utils.aoa_to_sheet(detailData);

  summarySheet["!cols"] = [{ wch: 24 }, { wch: 24 }];
  detailSheet["!cols"] = [
    { wch: 38 },
    { wch: 18 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 8 },
    { wch: 12 },
    { wch: 55 },
    { wch: 14 },
    { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Pending Details");

  const fileName = `cq-pending-details-${new Date()
    .toISOString()
    .slice(0, 10)}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}
  /************************************************************
   * UI
   ************************************************************/
  function injectStyle() {
    if (document.querySelector("#cq-auto-style")) return;

    const style = document.createElement("style");
    style.id = "cq-auto-style";

    style.textContent = `
      #cq-auto-panel {
  position: fixed;
  top: 95px;
  left: 24px;
  right: auto;
  width: 420px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 115px);
  background: #ffffff;
  border: 1px solid #dde2f1;
  border-radius: 18px;
  box-shadow: 0 18px 52px rgba(18, 28, 68, 0.20);
  z-index: 99999999;
  overflow: hidden;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2f64;
}
        max-height: calc(100vh - 105px);
        background: #ffffff;
        border: 1px solid #dde2f1;
        border-radius: 18px;
        box-shadow: 0 18px 52px rgba(18, 28, 68, 0.20);
        z-index: 99999999;
        overflow: hidden;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f2f64;
      }

      #cq-auto-panel.collapsed {
  width: 250px;
}

      #cq-auto-panel.collapsed .cq-auto-body {
        display: none;
      }

      .cq-auto-header {
        background: linear-gradient(135deg, ${BRAND_BLUE}, ${BRAND_PINK});
        color: white;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        touch-action: none;
      }

      .cq-auto-title {
        font-size: 15px;
        font-weight: 900;
      }

      .cq-auto-subtitle {
        font-size: 11px;
        opacity: 0.86;
        margin-top: 3px;
      }

      .cq-auto-collapse {
        border: none;
        background: rgba(255,255,255,0.20);
        color: white;
        border-radius: 10px;
        padding: 6px 10px;
        cursor: pointer;
        font-weight: 900;
      }

      .cq-auto-body {
        padding: 14px;
        overflow-y: auto;
        max-height: calc(100vh - 170px);
      }

      .cq-auto-note {
        background: #fff8e8;
        border: 1px solid #ffe0a8;
        color: #704900;
        border-radius: 14px;
        padding: 10px;
        font-size: 12px;
        line-height: 1.45;
        margin-bottom: 10px;
      }

      .cq-auto-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 10px;
      }

      .cq-auto-btn,
      .cq-auto-select,
      .cq-auto-input {
        border-radius: 12px;
        padding: 9px 10px;
        font-size: 12px;
        font-weight: 800;
      }

      .cq-auto-btn {
        border: none;
        cursor: pointer;
      }

      .cq-auto-primary {
        background: ${BRAND_BLUE};
        color: white;
      }

      .cq-auto-secondary {
        background: #f0f2fb;
        color: ${BRAND_BLUE};
      }

      .cq-auto-danger {
        background: #fff1f1;
        color: #b42318;
      }

      .cq-auto-select,
      .cq-auto-input {
        border: 1px solid #d8ddf0;
        background: white;
        color: #1f2f64;
      }

      .cq-auto-smallline {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        margin-bottom: 10px;
        color: #344054;
      }

      .cq-auto-status {
        font-size: 11px;
        color: #667085;
        margin: 8px 0;
      }

      .cq-auto-progress {
        height: 8px;
        border-radius: 999px;
        background: #edf0f7;
        overflow: hidden;
        margin-bottom: 4px;
      }

      #cq-auto-progress-bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, ${BRAND_BLUE}, ${BRAND_PINK});
        border-radius: 999px;
        transition: width 0.2s ease;
      }

      #cq-auto-progress-text {
        font-size: 10px;
        color: #667085;
        margin-bottom: 10px;
      }

      .cq-auto-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-bottom: 10px;
      }

      .cq-auto-stat {
        background: #f8f9fc;
        border: 1px solid #e8ebf5;
        border-radius: 14px;
        padding: 9px;
      }

      .cq-auto-stat span {
        display: block;
        color: #667085;
        font-size: 10px;
        margin-bottom: 3px;
      }

      .cq-auto-stat strong {
        display: block;
        color: ${BRAND_PINK};
        font-size: 20px;
      }

      .cq-auto-summary {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 10px;
      }

      .cq-auto-summary div {
        background: #f8f9fc;
        border: 1px solid #e8ebf5;
        border-radius: 14px;
        padding: 9px;
      }

      .cq-auto-summary span {
        display: block;
        font-size: 10px;
        color: #667085;
        margin-bottom: 3px;
      }

      .cq-auto-summary strong {
        display: block;
        color: ${BRAND_PINK};
        font-size: 20px;
      }

      .cq-auto-exam {
        border: 1px solid #e8ebf5;
        border-radius: 16px;
        padding: 11px;
        margin-bottom: 9px;
      }

      .cq-auto-exam.has-pending {
        background: #fff7fb;
        border-color: #ffcce8;
      }

      .cq-auto-exam.done {
        background: #f7fff9;
        border-color: #d8f4de;
      }

      .cq-auto-exam-top {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: center;
      }

      .cq-auto-exam-title {
        font-size: 12px;
        font-weight: 900;
        color: #1f2f64;
      }

      .cq-auto-meta {
        font-size: 11px;
        color: #667085;
        margin-top: 3px;
      }

      .cq-auto-pending-count {
        background: ${BRAND_PINK};
        color: white;
        min-width: 40px;
        text-align: center;
        padding: 9px 10px;
        border-radius: 999px;
        font-size: 16px;
        font-weight: 900;
      }

      .cq-auto-details-btn {
        margin-top: 9px;
        border: none;
        background: #eef1fb;
        color: ${BRAND_BLUE};
        border-radius: 999px;
        padding: 7px 10px;
        font-size: 11px;
        font-weight: 900;
        cursor: pointer;
      }

      .cq-auto-details {
        margin-top: 9px;
      }

      .cq-auto-question-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        background: white;
        border: 1px solid #edf0f7;
        border-radius: 12px;
        padding: 8px;
        margin-top: 6px;
      }

      .cq-auto-question-row.error {
        background: #fff7f7;
        border-color: #ffd2d2;
      }

      .cq-auto-question-row strong {
        display: block;
        font-size: 11px;
        color: #1f2f64;
      }

      .cq-auto-question-row span {
        display: block;
        font-size: 10px;
        color: #667085;
        margin-top: 2px;
      }

      .cq-auto-question-row b {
        background: ${BRAND_PINK};
        color: white;
        min-width: 28px;
        text-align: center;
        padding: 6px 8px;
        border-radius: 999px;
        font-size: 12px;
      }

      .cq-auto-no-detail {
        font-size: 11px;
        color: #16803c;
        font-weight: 800;
        margin-top: 8px;
      }

      .cq-auto-empty,
      .cq-auto-good {
        padding: 10px;
        border-radius: 14px;
        font-size: 12px;
        margin-bottom: 8px;
      }

      .cq-auto-empty {
        background: #f8f9fc;
        color: #667085;
      }

      .cq-auto-good {
        background: #f0fff5;
        color: #16803c;
        font-weight: 900;
      }
@media (max-width: 900px) {
  #cq-auto-panel {
    top: 12px;
    left: 12px;
    right: 12px;
    width: auto;
    max-width: none;
    max-height: calc(100vh - 24px);
    border-radius: 16px;
  }

  .cq-auto-body {
    max-height: calc(100vh - 100px);
  }

  .cq-auto-controls {
    grid-template-columns: 1fr;
  }

  .cq-auto-stats {
    grid-template-columns: repeat(3, 1fr);
  }

  .cq-auto-summary {
    grid-template-columns: repeat(2, 1fr);
  }

  .cq-auto-exam-top {
    grid-template-columns: 1fr;
  }

  .cq-auto-pending-count {
    width: fit-content;
  }
}

@media (max-width: 520px) {
  #cq-auto-panel {
    top: 8px;
    left: 8px;
    right: 8px;
    max-height: calc(100vh - 16px);
  }

  .cq-auto-header {
    padding: 12px;
  }

  .cq-auto-body {
    padding: 10px;
  }

  .cq-auto-title {
    font-size: 14px;
  }

  .cq-auto-subtitle {
    font-size: 10px;
  }

  .cq-auto-note {
    font-size: 11px;
    padding: 8px;
  }

  .cq-auto-stats {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }

  .cq-auto-stat {
    padding: 7px;
  }

  .cq-auto-stat strong {
    font-size: 16px;
  }

  .cq-auto-summary {
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .cq-auto-summary strong {
    font-size: 16px;
  }

  .cq-auto-controls {
    gap: 6px;
  }

  .cq-auto-btn,
  .cq-auto-select,
  .cq-auto-input {
    padding: 8px;
    font-size: 11px;
  }

  .cq-auto-exam {
    padding: 9px;
  }

  .cq-auto-exam-title {
    font-size: 11px;
  }

  .cq-auto-meta {
    font-size: 10px;
  }
}
`;

    document.head.appendChild(style);
  }

function makePanelDraggable() {
  const panel = document.querySelector("#cq-auto-panel");
  const header = document.querySelector(".cq-auto-header");

  if (!panel || !header) return;

  header.style.cursor = "move";
  header.style.touchAction = "none";

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.onpointerdown = function (event) {
    if (event.target.closest("button")) return;

    isDragging = true;

    const rect = panel.getBoundingClientRect();

    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    panel.style.position = "fixed";
    panel.style.left = `${startLeft}px`;
    panel.style.top = `${startTop}px`;
    panel.style.right = "auto";

    header.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";

    event.preventDefault();
  };

  header.onpointermove = function (event) {
    if (!isDragging) return;

    const panelRect = panel.getBoundingClientRect();

    const maxLeft = window.innerWidth - panelRect.width - 8;
    const maxTop = window.innerHeight - panelRect.height - 8;

    let nextLeft = startLeft + event.clientX - startX;
    let nextTop = startTop + event.clientY - startY;

    nextLeft = Math.max(8, Math.min(nextLeft, maxLeft));
    nextTop = Math.max(8, Math.min(nextTop, maxTop));

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";

    event.preventDefault();
  };

  header.onpointerup = function (event) {
    isDragging = false;
    document.body.style.userSelect = "";

    try {
      header.releasePointerCapture(event.pointerId);
    } catch (e) {}
  };

  header.onpointercancel = function () {
    isDragging = false;
    document.body.style.userSelect = "";
  };
}
  function renderDashboard() {
    if (!document.body) return;

    injectStyle();

    let panel = document.querySelector("#cq-auto-panel");

    if (!panel) {
      panel = document.createElement("div");
      panel.id = "cq-auto-panel";
      document.body.appendChild(panel);
    }

    const subjects = readStore(STORAGE.subjects, []);
    const exams = readStore(STORAGE.exams, []);
    const questionCache = readStore(STORAGE.questionCache, {});
    const safeQuestionCache =
  questionCache && typeof questionCache === "object" && !Array.isArray(questionCache)
    ? questionCache
    : {};

const questionCacheCount = Object.values(safeQuestionCache).reduce(
  (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
  0
);

    const selectedScope = localStorage.getItem(STORAGE.scope) || "HSC";
    const hideZero = localStorage.getItem(STORAGE.hideZero) !== "false";

    panel.innerHTML = `
      <div class="cq-auto-header">
        <div>
          <div class="cq-auto-title">CQ Pending Auto Scanner</div>
          <div class="cq-auto-subtitle">Auto-detects questions and scans pending scripts</div>
        </div>
        <button class="cq-auto-collapse" id="cq-auto-collapse">−</button>
      </div>

      <div class="cq-auto-body">
        <div class="cq-auto-note">
          Recommended: start with HSC/SSC, not ALL. Full scan may take time because it checks every CQ question one by one.
        </div>

        <div class="cq-auto-stats">
          <div class="cq-auto-stat"><span>Subjects</span><strong>${subjects.length}</strong></div>
          <div class="cq-auto-stat"><span>Exams</span><strong>${exams.length}</strong></div>
          <div class="cq-auto-stat"><span>Cached Qs</span><strong>${questionCacheCount}</strong></div>
        </div>

        <div class="cq-auto-controls">
          <select class="cq-auto-select" id="cq-auto-scope">
            <option value="HSC" ${selectedScope === "HSC" ? "selected" : ""}>HSC</option>
            <option value="SSC" ${selectedScope === "SSC" ? "selected" : ""}>SSC</option>
            <option value="C8" ${selectedScope === "C8" ? "selected" : ""}>Class 8</option>
            <option value="C7" ${selectedScope === "C7" ? "selected" : ""}>Class 7</option>
            <option value="C6" ${selectedScope === "C6" ? "selected" : ""}>Class 6</option>
            <option value="C5" ${selectedScope === "C5" ? "selected" : ""}>Class 5</option>
            <option value="ALL" ${selectedScope === "ALL" ? "selected" : ""}>ALL</option>
          </select>

          <input class="cq-auto-input" id="cq-auto-limit" type="number" min="0" placeholder="Exam limit, 0 = all">

          <button class="cq-auto-btn cq-auto-primary" id="cq-auto-scan">Scan Pending</button>
          <button class="cq-auto-btn cq-auto-secondary" id="cq-auto-discover">Discover Exams</button>
          <button class="cq-auto-btn cq-auto-secondary" id="cq-auto-subjects">Reload Subjects</button>
          <button class="cq-auto-btn cq-auto-secondary" id="cq-auto-export">Export Result CSV</button>
          <button class="cq-auto-btn cq-auto-danger" id="cq-auto-stop">Stop Scan</button>
          <button class="cq-auto-btn cq-auto-danger" id="cq-auto-clear">Clear Cache</button>
        </div>

        <label class="cq-auto-smallline">
          <input type="checkbox" id="cq-auto-hide-zero" ${hideZero ? "checked" : ""}>
          Show only exams with pending scripts
        </label>

        <div class="cq-auto-status" id="cq-auto-status">Ready</div>

        <div class="cq-auto-progress">
          <div id="cq-auto-progress-bar"></div>
        </div>
        <div id="cq-auto-progress-text">0/0 scanned</div>

        <div id="cq-auto-results">
          <div class="cq-auto-empty">Click “Scan Pending” to start checking exams.</div>
        </div>
      </div>
    `;

    document.querySelector("#cq-auto-scan")?.addEventListener("click", scanPending);
    document.querySelector("#cq-auto-discover")?.addEventListener("click", discoverExams);
    document.querySelector("#cq-auto-subjects")?.addEventListener("click", loadSubjects);
    document.querySelector("#cq-auto-stop")?.addEventListener("click", stopCurrentScan);
    document.querySelector("#cq-auto-clear")?.addEventListener("click", clearExamCache);
    document.querySelector("#cq-auto-export")?.addEventListener("click", exportVisibleResults);

    document.querySelector("#cq-auto-hide-zero")?.addEventListener("change", (event) => {
      localStorage.setItem(STORAGE.hideZero, event.target.checked ? "true" : "false");
    });

    document.querySelector("#cq-auto-scope")?.addEventListener("change", (event) => {
      localStorage.setItem(STORAGE.scope, event.target.value);
    });

    document.querySelector("#cq-auto-collapse")?.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      const btn = document.querySelector("#cq-auto-collapse");
      if (btn) btn.textContent = panel.classList.contains("collapsed") ? "+" : "−";
    });
    makePanelDraggable();
  }

  function init() {
    if (isReady) return;
    isReady = true;
    renderDashboard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
