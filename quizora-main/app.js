import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
 
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
 
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  query,
  orderByChild,
  equalTo,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
 
const firebaseConfig = {
  apiKey: "AIzaSyA6jlVCTXUUOwvncXgkIJX7Ku6z_xkH8Es",
  authDomain: "quizora-155b6.firebaseapp.com",
  databaseURL: "https://quizora-155b6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "quizora-155b6",
  storageBucket: "quizora-155b6.firebasestorage.app",
  messagingSenderId: "504478952413",
  appId: "1:504478952413:web:a936e9d266410645b86434"
};
 
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
 
const $ = id => document.getElementById(id);
let currentUser = null;
let currentRole = null;
let activeQuiz = null;
let activeSubmissionId = null;
let timerInterval = null;
let questionCount = 0;
let submitting = false;
 
function message(id, text, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", error);
}
 
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}
 
function showDashboard(role, view = role) {
  $("authPanel").hidden = true;
  $("appPanel").hidden = false;
  $("teacherPanel").hidden = view !== "teacher";
  $("studentPanel").hidden = view !== "student";
  $("takingPanel").hidden = true;
  $("welcomeTitle").textContent =
    view === "teacher" ? "Teacher dashboard"
    : role === "teacher" ? "Student view"
    : "Student dashboard";
  $("welcomeSubtitle").textContent = currentUser.email;
 
  const switchButton = role === "teacher"
    ? `<button id="switchViewButton" class="secondary">${
        view === "teacher" ? "Switch to student view" : "Back to teacher dashboard"
      }</button> `
    : "";
  $("userArea").innerHTML = `${switchButton}<button id="logoutButton">Sign out</button>`;
  $("logoutButton").addEventListener("click", () => signOut(auth));
 
  if (role === "teacher") {
    $("switchViewButton").addEventListener("click", async () => {
      // Leave any quiz in progress; the student can resume it later.
      stopTimer();
      activeQuiz = null;
      submitting = false;
 
      const next = view === "teacher" ? "student" : "teacher";
      showDashboard(role, next);
      if (next === "teacher") await loadTeacherQuizzes();
      else await loadStudentQuizzes();
    });
  }
}
 
function showAuth() {
  $("authPanel").hidden = false;
  $("appPanel").hidden = true;
  $("userArea").innerHTML = "";
  stopTimer();
}
 
// ---------------- AUTH ----------------
 
$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
 
  const email = $("email").value.trim();
  const password = $("password").value;
 
  try {
    message("authMessage", "Signing in...", false);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged takes it from here
  } catch (error) {
    console.error("Login error:", error);
    message("authMessage", error.message, true);
  }
});
 
$("signupButton").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
 
  if (!email || password.length < 6) {
    message("authMessage", "Enter an email and a password of at least 6 characters.", true);
    return;
  }
 
  try {
    message("authMessage", "Creating account...");
    await createUserWithEmailAndPassword(auth, email, password);
    // The profile and role are created in onAuthStateChanged below.
  } catch (error) {
    message("authMessage", error.message, true);
  }
});
 
function emailKey(email) {
  return email.toLowerCase().replace(/\./g, ",");
}
 
async function isTeacherEmail(email) {
  const key = emailKey(email);
  try {
    const teacherRef = ref(db, `teacherEmails/${key}`);
    const snap = await get(teacherRef);
    console.log("Teacher check | signed-in email: [" + email + "]");
    console.log("Teacher check | full path being read:", teacherRef.toString());
    console.log("Teacher check | found:", snap.exists(), "| value:", snap.val());
    return snap.exists();
  } catch (error) {
    console.error("Teacher check failed for key:", key, error);
    return false;
  }
}
 
onAuthStateChanged(auth, async user => {
  currentUser = user;
 
  if (!user) {
    currentRole = null;
    showAuth();
    return;
  }
 
  try {
    message("authMessage", "Loading your profile...", false);
 
    const role = (await isTeacherEmail(user.email)) ? "teacher" : "student";
    const profileRef = ref(db, `users/${user.uid}`);
    const snapshot = await get(profileRef);
 
    if (!snapshot.exists() || snapshot.val().role !== role) {
      await set(profileRef, {
        email: user.email,
        role,
        createdAt: snapshot.exists() ? (snapshot.val().createdAt || Date.now()) : Date.now()
      });
    }
 
    currentRole = role;
 
    message("authMessage", "");
    showDashboard(currentRole);
 
    if (currentRole === "teacher") {
      await loadTeacherQuizzes();
    } else {
      await loadStudentQuizzes();
    }
  } catch (error) {
    console.error("Profile error:", error);
    message("authMessage", "Could not load your profile: " + error.message, true);
    showAuth();
  }
});
 
// ---------------- TEACHER: BUILD QUIZZES ----------------
 
function addQuestionEditor() {
  questionCount++;
  const number = questionCount;
  const el = document.createElement("div");
  el.className = "question-editor";
  el.dataset.question = number;
 
  el.innerHTML = `
    <h3>Question ${number}</h3>
    <label>Question text</label>
    <input class="question-text" required maxlength="500"
      placeholder="Type your question">
 
    <div class="two-columns">
      ${[0, 1, 2, 3].map(i => `
        <div>
          <label>Choice ${String.fromCharCode(65 + i)}</label>
          <input class="option" required maxlength="250"
            placeholder="Answer choice ${String.fromCharCode(65 + i)}">
        </div>
      `).join("")}
    </div>
 
    <label>Correct answer</label>
    <select class="correct-answer">
      <option value="0">Choice A</option>
      <option value="1">Choice B</option>
      <option value="2">Choice C</option>
      <option value="3">Choice D</option>
    </select>
 
    <button type="button" class="remove secondary">Remove question</button>
  `;
 
  el.querySelector(".remove").addEventListener("click", () => {
    el.remove();
    renumberQuestions();
  });
 
  $("questionBuilder").appendChild(el);
}
 
function renumberQuestions() {
  [...$("questionBuilder").children].forEach((el, i) => {
    el.querySelector("h3").textContent = `Question ${i + 1}`;
  });
}
 
$("addQuestion").addEventListener("click", addQuestionEditor);
addQuestionEditor();
 
$("quizForm").addEventListener("submit", async event => {
  event.preventDefault();
 
  const editors = [...$("questionBuilder").children];
 
  if (editors.length === 0) {
    message("teacherMessage", "Add at least one question.", true);
    return;
  }
 
  const questions = editors.map(el => ({
    text: el.querySelector(".question-text").value.trim(),
    options: [...el.querySelectorAll(".option")].map(input => input.value.trim()),
    correctIndex: Number(el.querySelector(".correct-answer").value)
  }));
 
  if (questions.some(q => !q.text || q.options.some(o => !o))) {
    message("teacherMessage", "Complete every question and answer choice.", true);
    return;
  }
 
  const deadline = new Date($("deadline").value);
 
  if (Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
    message("teacherMessage", "Choose a future deadline.", true);
    return;
  }
 
  const duration = Number($("duration").value);
 
  if (!Number.isInteger(duration) || duration < 1 || duration > 180) {
    message("teacherMessage", "Time limit must be between 1 and 180 minutes.", true);
    return;
  }
 
  try {
    message("teacherMessage", "Publishing quiz...");
 
    await push(ref(db, "quizzes"), {
      title: $("quizTitle").value.trim(),
      teacherId: currentUser.uid,
      teacherEmail: currentUser.email,
      questions,
      duration,
      deadline: deadline.toISOString(),
      published: true,
      createdAt: serverTimestamp()
    });
 
    $("quizForm").reset();
    $("duration").value = 15;
    $("questionBuilder").innerHTML = "";
    questionCount = 0;
    addQuestionEditor();
 
    message("teacherMessage", "Quiz published!");
    await loadTeacherQuizzes();
  } catch (error) {
    message("teacherMessage", error.message, true);
  }
});
 
async function loadTeacherQuizzes() {
  const container = $("teacherQuizzes");
  container.innerHTML = '<p class="muted">Loading quizzes...</p>';
 
  try {
    const snapshot = await get(
      query(ref(db, "quizzes"), orderByChild("teacherId"), equalTo(currentUser.uid))
    );
 
    if (!snapshot.exists()) {
      container.innerHTML = '<div class="empty">No quizzes yet. Create your first one above.</div>';
      return;
    }
 
    const quizzes = [];
    snapshot.forEach(child => {
      quizzes.push({ id: child.key, ...child.val() });
    });
    quizzes.reverse(); // newest first
 
    container.innerHTML = "";
 
    for (const quiz of quizzes) {
      const card = document.createElement("article");
      card.className = "quiz-card";
      card.innerHTML = `
        <h3>${escapeHTML(quiz.title)}</h3>
        <p>${quiz.questions.length} questions · ${quiz.duration} minutes</p>
        <p class="muted">Deadline: ${new Date(quiz.deadline).toLocaleString()}</p>
        <div class="tracker"><p>Loading submissions...</p></div>
      `;
      container.appendChild(card);
 
      const tracker = card.querySelector(".tracker");
      try {
        const subSnap = await get(
          query(ref(db, "submissions"), orderByChild("quizId"), equalTo(quiz.id))
        );
        const rows = Object.values(subSnap.val() || {});
 
        tracker.innerHTML = `
          <p><strong>${rows.filter(s => s.status === "submitted").length}</strong> submitted ·
          <strong>${rows.filter(s => s.status === "in-progress").length}</strong> in progress</p>
          <p class="muted">Only accounts that started the quiz appear here.</p>
          ${rows.map(s => `
            <p>${escapeHTML(s.email || "Student")} — ${
              s.status === "submitted"
                ? `Finished · ${s.score}/${s.total}`
                : "In progress"
            }</p>
          `).join("")}
        `;
      } catch (error) {
        tracker.textContent = "Unable to load submissions: " + error.message;
      }
    }
  } catch (error) {
    container.textContent = "Error: " + error.message;
  }
}
 
// ---------------- STUDENT: FIND AND TAKE QUIZZES ----------------
 
async function loadStudentQuizzes() {
  const container = $("studentQuizzes");
  container.innerHTML = '<p class="muted">Loading quizzes...</p>';
 
  try {
    const snapshot = await get(
      query(ref(db, "quizzes"), orderByChild("published"), equalTo(true))
    );
 
    const quizzes = [];
    snapshot.forEach(child => {
      quizzes.push({ id: child.key, ...child.val() });
    });
    quizzes.reverse();
 
    const cards = [];
 
    for (const quiz of quizzes) {
      const submissionId = `${quiz.id}_${currentUser.uid}`;
      const subSnap = await get(ref(db, `submissions/${submissionId}`));
      const sub = subSnap.exists() ? subSnap.val() : null;
      const finished = sub?.status === "submitted";
      const started = sub?.status === "in-progress";
      const expired = Date.now() >= new Date(quiz.deadline).getTime();
 
      const card = document.createElement("article");
      card.className = "quiz-card";
      card.innerHTML = `
        <h3>${escapeHTML(quiz.title)}</h3>
        <p>${quiz.questions.length} questions · ${quiz.duration} minutes</p>
        <p class="muted">Deadline: ${new Date(quiz.deadline).toLocaleString()}</p>
        <p>${finished ? `Completed · Score: ${sub.score}/${sub.total}`
          : started ? "In progress"
          : expired ? "Deadline passed" : "Not started"}</p>
        <button ${finished || expired ? "disabled" : ""}>
          ${finished ? "Completed" : expired ? "Closed" : started ? "Continue quiz" : "Start quiz"}
        </button>
      `;
 
      if (!finished && !expired) {
        card.querySelector("button").addEventListener("click", () =>
          startQuiz(quiz.id, quiz)
        );
      }
 
      cards.push(card);
    }
 
    container.innerHTML = "";
 
    if (cards.length === 0) {
      container.innerHTML = '<div class="empty">No quizzes have been published yet.</div>';
    } else {
      cards.forEach(card => container.appendChild(card));
    }
  } catch (error) {
    container.textContent = "Error: " + error.message;
  }
}
 
async function startQuiz(quizId, quiz) {
  if (Date.now() >= new Date(quiz.deadline).getTime()) {
    message("answerMessage", "This quiz is past its deadline.", true);
    return;
  }
 
  try {
    activeQuiz = { ...quiz, id: quizId };
    activeSubmissionId = `${quizId}_${currentUser.uid}`;
    submitting = false;
 
    const submissionRef = ref(db, `submissions/${activeSubmissionId}`);
    const existing = await get(submissionRef);
    let startedAt;
 
    if (existing.exists()) {
      const data = existing.val();
 
      if (data.status === "submitted") {
        message("answerMessage", "You have already submitted this quiz.", true);
        return;
      }
 
      startedAt = Number(data.startedAt) || Date.now();
    } else {
      startedAt = Date.now();
      await set(submissionRef, {
        quizId,
        studentId: currentUser.uid,
        email: currentUser.email,
        status: "in-progress",
        startedAt
      });
    }
 
    $("studentPanel").hidden = true;
    $("takingPanel").hidden = false;
    $("takingTitle").textContent = quiz.title;
    $("quizProgress").textContent = `${quiz.questions.length} questions`;
    $("answerQuestions").innerHTML = "";
    $("answerForm").querySelector("button[type=submit]").disabled = false;
 
    quiz.questions.forEach((question, i) => {
      const box = document.createElement("div");
      box.className = "question-card";
      box.innerHTML = `
        <h3>${i + 1}. ${escapeHTML(question.text)}</h3>
        ${question.options.map((option, j) => `
          <div class="choice">
            <input type="radio" name="q${i}" id="q${i}_${j}" value="${j}" required>
            <label for="q${i}_${j}">${String.fromCharCode(65 + j)}. ${escapeHTML(option)}</label>
          </div>
        `).join("")}
      `;
      $("answerQuestions").appendChild(box);
    });
 
    const startedDeadline = startedAt + quiz.duration * 60 * 1000;
    const deadline = new Date(quiz.deadline).getTime();
    const endTime = Math.min(startedDeadline, deadline);
 
    $("answerForm").dataset.endTime = String(endTime);
    $("answerForm").dataset.startedAt = String(startedAt);
    message("answerMessage", "");
 
    const updateTimer = () => {
      const secondsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      $("timer").textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
 
      if (secondsLeft <= 0) {
        stopTimer();
        submitQuiz(true);
      }
    };
 
    stopTimer();
    updateTimer();
    if (!submitting) timerInterval = setInterval(updateTimer, 1000);
  } catch (error) {
    console.error("Start quiz error:", error);
    message("answerMessage", error.message, true);
  }
}
 
function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}
 
$("answerForm").addEventListener("submit", async event => {
  event.preventDefault();
  await submitQuiz(false);
});
 
async function submitQuiz(autoSubmit) {
  if (!activeQuiz || submitting) return;
 
  const form = $("answerForm");
  const endTime = Number(form.dataset.endTime);
  const answers = activeQuiz.questions.map((_, i) => {
    const selected = form.querySelector(`input[name="q${i}"]:checked`);
    return selected ? Number(selected.value) : -1;
  });
 
  if (!autoSubmit && Date.now() < endTime && answers.some(a => a < 0)) {
    message("answerMessage", "Please answer every question before submitting.", true);
    return;
  }
 
  submitting = true;
  stopTimer();
  form.querySelector("button[type=submit]").disabled = true;
 
  try {
    const score = answers.reduce((total, answer, i) =>
      total + (answer === activeQuiz.questions[i].correctIndex ? 1 : 0), 0
    );
 
    await set(ref(db, `submissions/${activeSubmissionId}`), {
      quizId: activeQuiz.id,
      studentId: currentUser.uid,
      email: currentUser.email,
      startedAt: Number(form.dataset.startedAt) || Date.now(),
      answers,
      score,
      total: activeQuiz.questions.length,
      status: "submitted",
      submittedAt: serverTimestamp()
    });
 
    $("takingPanel").hidden = true;
    $("studentPanel").hidden = false;
    activeQuiz = null;
    message("answerMessage", "");
    alert(`Quiz submitted! Your score is ${score}/${answers.length}.`);
    await loadStudentQuizzes();
  } catch (error) {
    submitting = false;
    form.querySelector("button[type=submit]").disabled = false;
    message("answerMessage", error.message, true);
  }
}
