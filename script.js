const storage = {
  get(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Failed to parse storage", error);
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const dataStore = {
  cards: [],
  dataSets: {
    daily: [],
    business: [],
    enterprise: [],
  },
  categories: [],
};

const buildDataSets = (cards) => {
  const sets = { daily: [], business: [], enterprise: [] };
  const categories = new Set();
  cards.forEach((card) => {
    if (sets[card.level]) {
      sets[card.level].push(card);
      categories.add(card.category);
    }
  });
  dataStore.cards = cards;
  dataStore.dataSets = sets;
  dataStore.categories = Array.from(categories).sort();
};

const loadVocab = async () => {
  try {
    const response = await fetch('data/vocab.json');
    if (!response.ok) {
      throw new Error(`Failed to load vocab: ${response.status}`);
    }
    const payload = await response.json();
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    buildDataSets(cards);
  } catch (error) {
    console.error('Failed to load vocab data', error);
    buildDataSets([]);
  }
};

const getFilteredCards = (level, category) => {
  // Previously, level/category filters were applied inconsistently between Flashcards and Quiz.
  // Centralizing the filter here ensures both flows always respect the same settings.
  const cards = dataStore.dataSets[level] || [];
  if (!category || category === 'all') return cards;
  return cards.filter((card) => card.category === category);
};
const defaultProgress = {
  totals: { total: 0, correct: 0, streak: 0 },
  levels: {
    daily: { total: 0, correct: 0 },
    business: { total: 0, correct: 0 },
    enterprise: { total: 0, correct: 0 },
  },
  cards: {},
};

const settingsDefaults = {
  name: "",
  focus: "balanced",
  reminder: false,
  ttsRate: "1",
  ttsLang: "en-US",
  ttsVoice: "auto",
  level: "daily",
  category: "all",
};

const favoritesDefault = [];

const progress = storage.get("lexicore_progress", defaultProgress);
const settings = storage.get("lexicore_settings", settingsDefaults);
let favorites = new Set(storage.get("lexicore_favorites", favoritesDefault));

const state = {
  level: "daily",
  currentCard: null,
  quiz: {
    timer: null,
    timeLeft: 60,
    running: false,
    total: 0,
    correct: 0,
    level: "daily",
  },
};

const elements = {
  greeting: document.getElementById("user-greeting"),
  reminderBanner: document.getElementById("reminder-banner"),
  heroSentence: document.getElementById("hero-sentence"),
  heroTts: document.getElementById("hero-tts"),
  navLinks: document.querySelectorAll(".nav__link"),
  jumpButtons: document.querySelectorAll("[data-jump]"),
  levelSwitch: document.getElementById("level-switch"),
  cardLevel: document.getElementById("card-level"),
  cardContext: document.getElementById("card-context"),
  cardJp: document.getElementById("card-jp"),
  cardEn: document.getElementById("card-en"),
  cardHint: document.getElementById("card-hint"),
  cardAnswer: document.getElementById("card-answer"),
  revealButton: document.getElementById("reveal-answer"),
  markKnown: document.getElementById("mark-known"),
  markUnknown: document.getElementById("mark-unknown"),
  favoriteToggle: document.getElementById("favorite-toggle"),
  flashcardTts: document.getElementById("flashcard-tts"),
  flashTotal: document.getElementById("flash-total"),
  flashCorrect: document.getElementById("flash-correct"),
  flashStreak: document.getElementById("flash-streak"),
  quizLevel: document.getElementById("quiz-level"),
  startQuiz: document.getElementById("start-quiz"),
  quizArea: document.getElementById("quiz-area"),
  quizQuestion: document.getElementById("quiz-question"),
  quizOptions: document.getElementById("quiz-options"),
  quizTts: document.getElementById("quiz-tts"),
  quizTimer: document.getElementById("quiz-timer"),
  quizTotal: document.getElementById("quiz-total"),
  quizCorrect: document.getElementById("quiz-correct"),
  quizResult: document.getElementById("quiz-result"),
  resultTotal: document.getElementById("result-total"),
  resultCorrect: document.getElementById("result-correct"),
  resultAccuracy: document.getElementById("result-accuracy"),
  retryQuiz: document.getElementById("retry-quiz"),
  overallTotal: document.getElementById("overall-total"),
  overallCorrect: document.getElementById("overall-correct"),
  overallStreak: document.getElementById("overall-streak"),
  overallAccuracy: document.getElementById("overall-accuracy"),
  overallAccuracyText: document.getElementById("overall-accuracy-text"),
  levelProgress: document.getElementById("level-progress"),
  favorites: document.getElementById("favorites"),
  favoritesList: document.getElementById("favorites-list"),
  favoritesEmpty: document.getElementById("favorites-empty"),
  favoritesCount: document.getElementById("favorites-count"),
  settingsForm: document.getElementById("settings-form"),
  settingsStatus: document.getElementById("settings-status"),
  userName: document.getElementById("user-name"),
  focusArea: document.getElementById("focus-area"),
  reminderOpt: document.getElementById("reminder-opt"),
  defaultLevel: document.getElementById("default-level"),
  categoryFilter: document.getElementById("category-filter"),
  ttsRate: document.getElementById("tts-rate"),
  ttsLang: document.getElementById("tts-lang"),
  ttsVoice: document.getElementById("tts-voice"),
  ttsWarning: document.getElementById("tts-warning"),
};

const ttsState = {
  supported: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
  voices: [],
  activeButton: null,
};

const updateGreeting = () => {
  const name = settings.name?.trim();
  elements.greeting.textContent = name ? `Welcome, ${name}` : "Welcome";
};

const updateReminder = () => {
  if (settings.reminder) {
    elements.reminderBanner.textContent =
      "Daily reminder: review 5 cards before your first meeting.";
    elements.reminderBanner.style.display = "block";
  } else {
    elements.reminderBanner.textContent = "";
    elements.reminderBanner.style.display = "none";
  }
};

const setTtsButtonState = (button, isSpeaking) => {
  if (!button) return;
  button.textContent = "👂";
  button.classList.toggle("is-speaking", isSpeaking);
  button.setAttribute("aria-pressed", isSpeaking ? "true" : "false");
  button.setAttribute("aria-label", isSpeaking ? "Stop audio" : "Play audio");
};

const stopSpeech = () => {
  if (!ttsState.supported) return;
  speechSynthesis.cancel();
  if (ttsState.activeButton) {
    setTtsButtonState(ttsState.activeButton, false);
  }
  ttsState.activeButton = null;
};

const getSelectedVoice = () => {
  if (!ttsState.voices.length) return null;
  if (settings.ttsVoice && settings.ttsVoice !== "auto") {
    const selected = ttsState.voices.find((voice) => voice.name === settings.ttsVoice);
    if (selected) return selected;
  }
  const byLang = ttsState.voices.find((voice) => voice.lang === settings.ttsLang);
  return byLang || ttsState.voices[0];
};

const updateVoiceSelect = () => {
  if (!elements.ttsVoice) return;
  const voicesForLang = ttsState.voices.filter((voice) => voice.lang === settings.ttsLang);
  elements.ttsVoice.innerHTML = "";
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = voicesForLang.length
    ? "Auto (recommended)"
    : "Auto (no English voice found)";
  elements.ttsVoice.appendChild(autoOption);
  voicesForLang.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = voice.name;
    elements.ttsVoice.appendChild(option);
  });
  const hasSelected = voicesForLang.some((voice) => voice.name === settings.ttsVoice);
  elements.ttsVoice.value = hasSelected ? settings.ttsVoice : "auto";
};

const loadVoices = () => {
  if (!ttsState.supported) return;
  ttsState.voices = speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang && voice.lang.startsWith("en"));
  updateVoiceSelect();
};

const speakText = (text, button) => {
  if (!ttsState.supported || !text) return;
  if (ttsState.activeButton === button && speechSynthesis.speaking) {
    stopSpeech();
    return;
  }
  stopSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Number(settings.ttsRate) || 1;
  utterance.lang = settings.ttsLang || "en-US";
  const selectedVoice = getSelectedVoice();
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  ttsState.activeButton = button;
  setTtsButtonState(button, true);
  utterance.onend = () => {
    if (ttsState.activeButton === button) {
      setTtsButtonState(button, false);
      ttsState.activeButton = null;
    }
  };
  utterance.onerror = () => {
    if (ttsState.activeButton === button) {
      setTtsButtonState(button, false);
      ttsState.activeButton = null;
    }
  };
  speechSynthesis.speak(utterance);
};

const updateTtsSupportUI = () => {
  const supported = ttsState.supported;
  const buttons = [elements.flashcardTts, elements.quizTts, elements.heroTts];
  buttons.forEach((button) => {
    if (!button) return;
    setTtsButtonState(button, false);
    if (!supported) button.disabled = true;
  });
  if (!supported) {
    elements.ttsWarning.textContent = "このブラウザは音声読み上げに対応していません。";
  } else {
    elements.ttsWarning.textContent = "";
  }
  elements.ttsRate.disabled = !supported;
  elements.ttsLang.disabled = !supported;
  elements.ttsVoice.disabled = !supported;
};

const updateCategoryOptions = () => {
  if (!elements.categoryFilter) return;
  elements.categoryFilter.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All categories";
  elements.categoryFilter.appendChild(allOption);
  dataStore.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    elements.categoryFilter.appendChild(option);
  });
  elements.categoryFilter.value = settings.category || "all";
};

const updateSettingsForm = () => {
  elements.userName.value = settings.name || "";
  elements.focusArea.value = settings.focus || "balanced";
  elements.reminderOpt.checked = Boolean(settings.reminder);
  elements.defaultLevel.value = settings.level || "daily";
  elements.ttsRate.value = settings.ttsRate || "1";
  elements.ttsLang.value = settings.ttsLang || "en-US";
  updateVoiceSelect();
  updateCategoryOptions();
  elements.settingsStatus.textContent = "Settings are up to date.";
};

const saveProgress = () => storage.set("lexicore_progress", progress);
const saveSettings = () => storage.set("lexicore_settings", settings);
const saveFavorites = () => storage.set("lexicore_favorites", Array.from(favorites));

const getAllCards = () => dataStore.cards;

const getCardById = (cardId) => getAllCards().find((card) => card.id === cardId);

const setFavorite = (cardId, shouldFavorite) => {
  if (shouldFavorite) {
    favorites.add(cardId);
  } else {
    favorites.delete(cardId);
  }
  saveFavorites();
};

const renderFavoritesList = () => {
  const favoriteCards = Array.from(favorites)
    .map((cardId) => getCardById(cardId))
    .filter(Boolean);

  elements.favoritesCount.textContent = favoriteCards.length;
  elements.favoritesList.innerHTML = "";
  elements.favoritesEmpty.style.display = favoriteCards.length ? "none" : "block";

  favoriteCards.forEach((card) => {
    const item = document.createElement("div");
    item.className = "favorites__item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tts-button";
    button.textContent = "👂";
    button.disabled = !ttsState.supported;
    button.setAttribute("aria-label", "Play audio");
    button.addEventListener("click", () => speakText(card.en, button));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost";
    removeButton.textContent = "お気に入り解除";
    removeButton.addEventListener("click", () => {
      setFavorite(card.id, false);
      renderFavoritesList();
      if (state.currentCard?.id === card.id) {
        renderCard(state.currentCard);
      }
    });

    item.innerHTML = `
      <div class="favorites__meta">
        <span class="tag">${card.category}</span>
        <span class="favorites__context">${card.hint}</span>
      </div>
      <p class="favorites__english">${card.en}</p>
      <p class="favorites__jp">${card.jp}</p>
    `;
    const actions = document.createElement("div");
    actions.className = "favorites__actions";
    actions.appendChild(button);
    actions.appendChild(removeButton);
    item.appendChild(actions);
    elements.favoritesList.appendChild(item);
  });
};

const updateFlashcardStats = () => {
  elements.flashTotal.textContent = progress.totals.total;
  elements.flashCorrect.textContent = progress.totals.correct;
  elements.flashStreak.textContent = progress.totals.streak;
};

const updateProgressUI = () => {
  elements.overallTotal.textContent = progress.totals.total;
  elements.overallCorrect.textContent = progress.totals.correct;
  elements.overallStreak.textContent = progress.totals.streak;
  const accuracy = progress.totals.total
    ? Math.round((progress.totals.correct / progress.totals.total) * 100)
    : 0;
  elements.overallAccuracy.style.width = `${accuracy}%`;
  elements.overallAccuracyText.textContent = `Accuracy ${accuracy}%`;

  elements.levelProgress.innerHTML = "";
  Object.entries(progress.levels).forEach(([level, stats]) => {
    const levelName =
      level === "daily"
        ? "Level 1: Daily"
        : level === "business"
          ? "Level 2: Business"
          : "Level 3: Enterprise & IT";
    const levelAccuracy = stats.total
      ? Math.round((stats.correct / stats.total) * 100)
      : 0;
    const row = document.createElement("div");
    row.className = "level-row";
    row.innerHTML = `
      <div class="level-row__header">
        <span>${levelName}</span>
        <span>${levelAccuracy}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-bar__fill" style="width: ${levelAccuracy}%"></div>
      </div>
      <div class="level-row__stats">${stats.correct} correct / ${stats.total} answers</div>
    `;
    elements.levelProgress.appendChild(row);
  });
};

const getCardStats = (cardId) => {
  if (!progress.cards[cardId]) {
    progress.cards[cardId] = { correct: 0, wrong: 0, seen: 0, lastSeen: null };
  }
  return progress.cards[cardId];
};

const getWeightedCard = (level) => {
  const cards = getFilteredCards(level, settings.category);
  if (!cards.length) return null;
  const weights = cards.map((card) => {
    const stats = getCardStats(card.id);
    const mastery = stats.correct - stats.wrong;
    const favoriteBoost = favorites.has(card.id) ? 2 : 0;
    return Math.max(1, 6 - mastery + favoriteBoost);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = Math.random() * totalWeight;
  for (let i = 0; i < cards.length; i += 1) {
    pick -= weights[i];
    if (pick <= 0) return cards[i];
  }
  return cards[0];
};

const renderCard = (card) => {
  stopSpeech();
  if (!card) {
    elements.cardLevel.textContent = "Level";
    elements.cardContext.textContent = "No cards";
    elements.cardJp.textContent = "フィルター条件に一致するカードがありません。";
    elements.cardEn.textContent = "";
    elements.cardHint.textContent = "";
    elements.cardAnswer.classList.add("hidden");
    elements.cardAnswer.setAttribute("aria-hidden", "true");
    elements.revealButton.disabled = true;
    elements.flashcardTts.disabled = true;
    elements.favoriteToggle.textContent = "☆ お気に入り";
    return;
  }
  state.currentCard = card;
  elements.cardLevel.textContent =
    state.level === "daily"
      ? "Level 1: Daily"
      : state.level === "business"
        ? "Level 2: Business"
        : "Level 3: Enterprise & IT";
  elements.cardContext.textContent = card.category;
  elements.cardJp.textContent = card.jp;
  elements.cardEn.textContent = card.en;
  elements.cardHint.textContent = card.hint;
  elements.cardAnswer.classList.add("hidden");
  elements.cardAnswer.setAttribute("aria-hidden", "true");
  elements.revealButton.disabled = false;
  elements.flashcardTts.disabled = true;
  const favoriteLabel = favorites.has(card.id) ? "★ お気に入り" : "☆ お気に入り";
  elements.favoriteToggle.textContent = favoriteLabel;
};

const recordAnswer = (isCorrect) => {
  const card = state.currentCard;
  if (!card) return;
  const stats = getCardStats(card.id);
  stats.seen += 1;
  stats.lastSeen = new Date().toISOString();
  if (isCorrect) {
    stats.correct += 1;
    progress.totals.correct += 1;
    progress.totals.streak += 1;
    progress.levels[state.level].correct += 1;
  } else {
    stats.wrong += 1;
    progress.totals.streak = 0;
  }
  progress.totals.total += 1;
  progress.levels[state.level].total += 1;
  saveProgress();
  updateFlashcardStats();
  updateProgressUI();
};

const showNextCard = () => {
  const nextCard = getWeightedCard(state.level);
  renderCard(nextCard);
};

const setLevel = (level) => {
  state.level = level;
  settings.level = level;
  saveSettings();
  if (elements.defaultLevel) {
    elements.defaultLevel.value = level;
  }
  document.querySelectorAll(".pill").forEach((button) => {
    button.classList.toggle("active", button.dataset.level === level);
  });
  showNextCard();
};

const revealAnswer = () => {
  elements.cardAnswer.classList.remove("hidden");
  elements.cardAnswer.setAttribute("aria-hidden", "false");
  elements.revealButton.disabled = true;
  elements.flashcardTts.disabled = !ttsState.supported;
};

const toggleFavorite = () => {
  const card = state.currentCard;
  if (!card) return;
  const nextValue = !favorites.has(card.id);
  setFavorite(card.id, nextValue);
  renderCard(card);
  renderFavoritesList();
};

const buildQuizQuestion = () => {
  const cards = getFilteredCards(state.quiz.level, settings.category);
  if (!cards.length) return { question: null, options: [] };
  const question = cards[Math.floor(Math.random() * cards.length)];
  const options = [question.en];
  while (options.length < 4) {
    const candidate = cards[Math.floor(Math.random() * cards.length)].en;
    if (!options.includes(candidate)) options.push(candidate);
  }
  return { question, options: options.sort(() => Math.random() - 0.5) };
};

const renderQuizQuestion = () => {
  stopSpeech();
  const { question, options } = buildQuizQuestion();
  state.quiz.currentQuestion = question;
  if (!question) {
    elements.quizQuestion.textContent = "該当カテゴリの問題がありません。";
    elements.quizOptions.innerHTML = "";
    elements.quizTts.disabled = true;
    return;
  }
  elements.quizQuestion.textContent = question.jp;
  elements.quizOptions.innerHTML = "";
  elements.quizTts.disabled = !ttsState.supported;
  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.textContent = option;
    button.addEventListener("click", () => handleQuizAnswer(option));
    elements.quizOptions.appendChild(button);
  });
};

const updateQuizStats = () => {
  elements.quizTimer.textContent = state.quiz.timeLeft;
  elements.quizTotal.textContent = state.quiz.total;
  elements.quizCorrect.textContent = state.quiz.correct;
};

const stopQuiz = () => {
  clearInterval(state.quiz.timer);
  state.quiz.running = false;
  elements.quizResult.classList.remove("hidden");
  elements.quizTts.disabled = true;
  const accuracy = state.quiz.total
    ? Math.round((state.quiz.correct / state.quiz.total) * 100)
    : 0;
  elements.resultTotal.textContent = state.quiz.total;
  elements.resultCorrect.textContent = state.quiz.correct;
  elements.resultAccuracy.textContent = `${accuracy}%`;
};

const handleQuizAnswer = (answer) => {
  if (!state.quiz.running) return;
  const isCorrect = answer === state.quiz.currentQuestion.en;
  state.quiz.total += 1;
  if (isCorrect) state.quiz.correct += 1;
  progress.totals.total += 1;
  progress.levels[state.quiz.level].total += 1;
  if (isCorrect) {
    progress.totals.correct += 1;
    progress.levels[state.quiz.level].correct += 1;
    progress.totals.streak += 1;
  } else {
    progress.totals.streak = 0;
  }
  saveProgress();
  updateProgressUI();
  updateQuizStats();
  renderQuizQuestion();
};

const startQuiz = () => {
  stopSpeech();
  state.quiz.level = elements.quizLevel.value;
  state.quiz.running = true;
  state.quiz.timeLeft = 60;
  state.quiz.total = 0;
  state.quiz.correct = 0;
  elements.quizResult.classList.add("hidden");
  updateQuizStats();
  renderQuizQuestion();
  clearInterval(state.quiz.timer);
  state.quiz.timer = setInterval(() => {
    state.quiz.timeLeft -= 1;
    updateQuizStats();
    if (state.quiz.timeLeft <= 0) {
      stopQuiz();
    }
  }, 1000);
};

const restartQuiz = () => {
  stopQuiz();
  startQuiz();
};

const handleSettingsSubmit = (event) => {
  event.preventDefault();
  settings.name = elements.userName.value.trim();
  settings.focus = elements.focusArea.value;
  settings.reminder = elements.reminderOpt.checked;
  settings.level = elements.defaultLevel.value;
  settings.category = elements.categoryFilter.value;
  settings.ttsRate = elements.ttsRate.value;
  settings.ttsLang = elements.ttsLang.value;
  settings.ttsVoice = elements.ttsVoice.value;
  saveSettings();
  updateGreeting();
  updateReminder();
  updateVoiceSelect();
  updateCategoryOptions();
  setLevel(settings.level);
  renderFavoritesList();
  elements.settingsStatus.textContent = "Settings saved.";
};

const setupNavigation = () => {
  elements.navLinks.forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
  elements.jumpButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.jump);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
};

const init = async () => {
  await loadVocab();
  updateGreeting();
  updateReminder();
  updateSettingsForm();
  updateTtsSupportUI();
  if (ttsState.supported) {
    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
  }
  updateFlashcardStats();
  updateProgressUI();
  setupNavigation();
  setLevel(settings.level || state.level);
  renderFavoritesList();
  elements.revealButton.addEventListener("click", revealAnswer);
  elements.flashcardTts.addEventListener("click", () => {
    speakText(elements.cardEn.textContent, elements.flashcardTts);
  });
  elements.markKnown.addEventListener("click", () => {
    recordAnswer(true);
    showNextCard();
  });
  elements.markUnknown.addEventListener("click", () => {
    recordAnswer(false);
    showNextCard();
  });
  elements.favoriteToggle.addEventListener("click", toggleFavorite);
  elements.levelSwitch.addEventListener("click", (event) => {
    const level = event.target.dataset.level;
    if (level) setLevel(level);
  });
  elements.startQuiz.addEventListener("click", startQuiz);
  elements.quizTts.addEventListener("click", () => {
    speakText(state.quiz.currentQuestion?.en, elements.quizTts);
  });
  elements.heroTts.addEventListener("click", () => {
    speakText(elements.heroSentence.textContent, elements.heroTts);
  });
  elements.retryQuiz.addEventListener("click", restartQuiz);
  elements.settingsForm.addEventListener("submit", handleSettingsSubmit);
  elements.defaultLevel.addEventListener("change", () => {
    settings.level = elements.defaultLevel.value;
    saveSettings();
    setLevel(settings.level);
  });
  elements.categoryFilter.addEventListener("change", () => {
    settings.category = elements.categoryFilter.value;
    saveSettings();
    showNextCard();
    renderFavoritesList();
  });
  elements.ttsLang.addEventListener("change", () => {
    settings.ttsLang = elements.ttsLang.value;
    updateVoiceSelect();
    saveSettings();
  });
  elements.ttsRate.addEventListener("change", () => {
    settings.ttsRate = elements.ttsRate.value;
    saveSettings();
  });
  elements.ttsVoice.addEventListener("change", () => {
    settings.ttsVoice = elements.ttsVoice.value;
    saveSettings();
  });
};

init();
