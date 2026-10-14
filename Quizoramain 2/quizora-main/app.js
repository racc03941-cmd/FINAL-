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
let activeQuiz = null;
let activeSubmissionId = null;
let timerInterval = null;
let questionCount = 0;
let submitting = false;
let signupInProgress = false;
 
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
 
// ---------------- SCREENS ----------------
 
// role = what the account is. view = which dashboard is showing.
// Teachers can switch view; students only ever see the student view.
function showDashboard(role, view = role) {
  $("authPanel").hidden = true;
  $("appPanel").hidden = false;
  $("teacherPanel").hidden = view !== "teacher";
  $("studentPanel").hidden = view !== "student";
  $("takingPanel").hidden = true;
  $("welcomeTitle").textContent =
    view === "teacher" ? "Teacher dashboard"
    : role === "teacher" ? "Student view"
    : "Your quizzes";
  $("welcomeSubtitle").textContent = currentUser.email;
 
  const switchButton = role === "teacher"
    ? `<button id="switchViewButton" class="ghost">${
        view === "teacher" ? "Switch to student view" : "Back to teacher dashboard"
      }</button>`
    : "";
  $("userArea").innerHTML = `${switchButton}<button id="logoutButton" class="ghost">Sign out</button>`;
  $("logoutButton").addEventListener("click", () => signOut(auth));
 
  if (role === "teacher") {
    $("switchViewButton").addEventListener("click", async () => {
      // Leave any quiz in progress; the student view lets them resume it.
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
 
// Reads the role from users/{uid}. Accounts without a profile become students.
async function loadRole(user) {
  const profileRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(profileRef);
 
  console.log("Role check | email:", user.email);
  console.log("Role check | uid:", user.uid);
  console.log("Role check | reading:", profileRef.toString());
 
  if (snapshot.exists()) {
    console.log("Role check | profile found:", JSON.stringify(snapshot.val()));
    return snapshot.val().role || "student";
  }
 
  console.log("Role check | NO profile at that path, creating a new student profile");
  await set(profileRef, {
    email: user.email,
    role: "student",
    createdAt: Date.now()
  });
  return "student";
}
 
async function enterApp(user) {
  currentUser = user;
 
  try {
    message("authMessage", "Loading your account...");
    const role = await loadRole(user);
    message("authMessage", "");
    showDashboard(role);
 
    if (role === "teacher") await loadTeacherQuizzes();
    else await loadStudentQuizzes();
  } catch (error) {
    console.error("Account error:", error);
    message("authMessage", "Could not load your account: " + error.message, true);
    showAuth();
  }
}
 
$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    message("authMessage", "Signing in...");
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (error) {
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
 
  // Stops onAuthStateChanged from creating a student profile before ours is saved.
  signupInProgress = true;
 
  try {
    message("authMessage", "Creating your account...");
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const newUser = result.user;
 
    await set(ref(db, `users/${newUser.uid}`), {
      email: newUser.email,
      role: "student",
      createdAt: Date.now()
    });
 
    signupInProgress = false;
    await enterApp(newUser);
  } catch (error) {
    signupInProgress = false;
    message("authMessage", error.message, true);
  }
});
 
onAuthStateChanged(auth, async user => {
  currentUser = user;
 
  if (!user) {
    showAuth();
    return;
  }
  if (signupInProgress) return;
 
  await enterApp(user);
});
 
// ---------------- TEACHER: BUILD QUIZZES ----------------
 
function addQuestionEditor() {
  questionCount++;
  const el = document.createElement("div");
  el.className = "question-editor";
 
  el.innerHTML = `
    <h3>Question ${questionCount}</h3>
    <label>Question text</label>
    <input class="question-text" required maxlength="500" placeholder="Type your question">
 
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
  questionCount = $("questionBuilder").children.length;
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
    message("teacherMessage", "Choose a deadline in the future.", true);
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
 
    message("teacherMessage", "Quiz published.");
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
      container.innerHTML = '<div class="empty">You have not published any quizzes yet. Build your first one above.</div>';
      return;
    }
 
    const quizzes = [];
    snapshot.forEach(child => {
      quizzes.push({ id: child.key, ...child.val() });
    });
    quizzes.reverse();
 
    container.innerHTML = "";
 
    for (const quiz of quizzes) {
      const card = document.createElement("article");
      card.className = "quiz-card teacher-card";
      card.innerHTML = `
        <div class="quiz-card-main">
          <h3>${escapeHTML(quiz.title)}</h3>
          <p class="muted">${quiz.questions.length} questions, ${quiz.duration} minutes. Due ${new Date(quiz.deadline).toLocaleString()}</p>
          <div class="tracker"><p class="muted">Loading submissions...</p></div>
        </div>
      `;
      container.appendChild(card);
 
      const tracker = card.querySelector(".tracker");
      try {
        const subSnap = await get(
          query(ref(db, "submissions"), orderByChild("quizId"), equalTo(quiz.id))
        );
        const rows = Object.values(subSnap.val() || {});
        const submitted = rows.filter(s => s.status === "submitted");
        const inProgress = rows.filter(s => s.status === "in-progress");
 
        tracker.innerHTML = `
          <p><strong>${submitted.length}</strong> submitted, <strong>${inProgress.length}</strong> in progress</p>
          ${rows.length === 0 ? '<p class="muted">No one has started this quiz yet.</p>' : `
            <ul class="results">
              ${rows.map(s => `
                <li>
                  <span>${escapeHTML(s.email || "Student")}</span>
                  <span>${s.status === "submitted" ? `${s.score}/${s.total}` : "In progress"}</span>
                </li>
              `).join("")}
            </ul>
            <p class="muted">Students appear here after they start the quiz.</p>
          `}
        `;
      } catch (error) {
        tracker.textContent = "Unable to load submissions: " + error.message;
      }
    }
  } catch (error) {
    container.textContent = "Error: " + error.message;
  }
}
 
// ---------------- STUDENT: QUIZ LIST ----------------
 
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
      const subSnap = await get(ref(db, `submissions/${quiz.id}_${currentUser.uid}`));
      const sub = subSnap.exists() ? subSnap.val() : null;
      const finished = sub?.status === "submitted";
      const started = sub?.status === "in-progress";
      const expired = Date.now() >= new Date(quiz.deadline).getTime();
 
      const state = finished ? "is-done" : expired ? "is-closed" : started ? "is-progress" : "";
      const status = finished ? `Completed. Score: ${sub.score}/${sub.total}`
        : expired ? "Deadline passed"
        : started ? "In progress"
        : "Not started";
      const label = finished ? "Completed" : expired ? "Closed" : started ? "Continue quiz" : "Start quiz";
 
      const card = document.createElement("article");
      card.className = `quiz-card ${state}`;
      card.innerHTML = `
        <div class="quiz-card-main">
          <h3>${escapeHTML(quiz.title)}</h3>
          <p class="muted">${quiz.questions.length} questions, ${quiz.duration} minutes. Due ${new Date(quiz.deadline).toLocaleString()}</p>
          <p class="status">${status}</p>
        </div>
        <button ${finished || expired ? "disabled" : ""}>${label}</button>
      `;
 
      if (!finished && !expired) {
        card.querySelector("button").addEventListener("click", () => startQuiz(quiz));
      }
      cards.push(card);
    }
 
    container.innerHTML = "";
 
    if (cards.length === 0) {
      container.innerHTML = '<div class="empty">No quizzes have been published yet. Check back soon.</div>';
    } else {
      cards.forEach(card => container.appendChild(card));
    }
  } catch (error) {
    container.textContent = "Error: " + error.message;
  }
}
 
// ---------------- STUDENT: TAKING A QUIZ ----------------
 
async function startQuiz(quiz) {
  message("studentMessage", "");
 
  if (Date.now() >= new Date(quiz.deadline).getTime()) {
    message("studentMessage", "This quiz is past its deadline.", true);
    return;
  }
 
  try {
    activeSubmissionId = `${quiz.id}_${currentUser.uid}`;
    submitting = false;
 
    const submissionRef = ref(db, `submissions/${activeSubmissionId}`);
    const existing = await get(submissionRef);
    let startedAt;
 
    if (existing.exists()) {
      const data = existing.val();
      if (data.status === "submitted") {
        message("studentMessage", "You have already submitted this quiz.", true);
        return;
      }
      startedAt = Number(data.startedAt) || Date.now();
    } else {
      startedAt = Date.now();
      await set(submissionRef, {
        quizId: quiz.id,
        studentId: currentUser.uid,
        email: currentUser.email,
        status: "in-progress",
        startedAt
      });
    }
 
    activeQuiz = quiz;
 
    $("studentPanel").hidden = true;
    $("takingPanel").hidden = false;
    $("takingTitle").textContent = quiz.title;
    $("quizProgress").textContent = `${quiz.questions.length} questions`;
    $("answerQuestions").innerHTML = "";
    $("answerForm").querySelector("button[type=submit]").disabled = false;
    message("answerMessage", "");
 
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
 
    const endTime = Math.min(
      startedAt + quiz.duration * 60 * 1000,
      new Date(quiz.deadline).getTime()
    );
    $("answerForm").dataset.endTime = String(endTime);
    $("answerForm").dataset.startedAt = String(startedAt);
 
    const updateTimer = () => {
      const secondsLeft = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      const minutes = Math.floor(secondsLeft / 60);
      const seconds = secondsLeft % 60;
      $("timer").textContent =
        `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      $("timer").classList.toggle("low", secondsLeft <= 60);
 
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
    message("studentMessage", error.message, true);
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
    message("answerMessage", "Answer every question before submitting.", true);
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
 
    const total = activeQuiz.questions.length;
    activeQuiz = null;
    $("takingPanel").hidden = true;
    $("studentPanel").hidden = false;
    message("answerMessage", "");
    message("studentMessage", `Quiz submitted. Your score is ${score}/${total}.`);
    await loadStudentQuizzes();
  } catch (error) {
    submitting = false;
    form.querySelector("button[type=submit]").disabled = false;
    message("answerMessage", error.message, true);
  }
}
 