const API_DOCUMENTS = '/api/documents';
const API_TENDERS = '/api/tender-decisions';
const API_SUPPLIERS = '/api/suppliers';
const DOCUMENT_STORAGE_KEY = 'doc-tracker-premium-v4';
const TENDER_STORAGE_KEY = 'tender-decisions-v1';

const DOCUMENT_STEPS = [
  { key: 'mine', label: 'На мне' },
  { key: 'review', label: 'На согласовании' },
  { key: 'approved', label: 'Согласовано' }
];

const TENDER_STAGE_LABELS = {
  mine: 'На мне',
  yulia_ivan: 'Юля / Иван',
  finance: 'Финансисты',
  olya_k: 'Оля К',
  yulia_d: 'Юля Д',
  mikhail: 'Михаил',
  paperwork: 'Оформление'
};

const elements = {
  tabs: [...document.querySelectorAll('[data-tab]')],
  views: [...document.querySelectorAll('[data-view]')],
  headerControlGroups: [...document.querySelectorAll('[data-header-controls]')],
  searchToggles: [...document.querySelectorAll('[data-search-toggle]')],
  brandCaption: document.getElementById('brandCaption'),
  openCreateBtn: document.getElementById('openCreateBtn'),
  openCreateLabel: document.getElementById('openCreateLabel'),

  activeMonth: document.getElementById('activeMonth'),
  prevMonthBtn: document.getElementById('prevMonthBtn'),
  nextMonthBtn: document.getElementById('nextMonthBtn'),
  documentStatusFilter: document.getElementById('documentStatusFilter'),
  documentSearch: document.getElementById('documentSearch'),
  documentsList: document.getElementById('documentsList'),

  tenderStatusFilter: document.getElementById('tenderStatusFilter'),
  tenderSearch: document.getElementById('tenderSearch'),
  tendersList: document.getElementById('tendersList'),

  documentModal: document.getElementById('documentModal'),
  documentModalTitle: document.getElementById('documentModalTitle'),
  documentForm: document.getElementById('documentForm'),
  documentMonth: document.getElementById('documentMonth'),
  appendixNumber: document.getElementById('appendixNumber'),
  projectName: document.getElementById('projectName'),
  counterparty: document.getElementById('counterparty'),
  internalNumber: document.getElementById('internalNumber'),
  tenderNumber: document.getElementById('tenderNumber'),
  documentApprovalDate: document.getElementById('documentApprovalDate'),
  documentStatus: document.getElementById('documentStatus'),
  nextYearDocument: document.getElementById('nextYearDocument'),
  nextYearLabel: document.getElementById('nextYearLabel'),
  documentComment: document.getElementById('documentComment'),

  tenderModal: document.getElementById('tenderModal'),
  tenderModalTitle: document.getElementById('tenderModalTitle'),
  tenderForm: document.getElementById('tenderForm'),
  tenderDecisionNumber: document.getElementById('tenderDecisionNumber'),
  tenderAmount: document.getElementById('tenderAmount'),
  tenderTitle: document.getElementById('tenderTitle'),
  tenderValidFrom: document.getElementById('tenderValidFrom'),
  tenderValidTo: document.getElementById('tenderValidTo'),
  tenderComment: document.getElementById('tenderComment'),
  tenderSupplierInput: document.getElementById('tenderSupplierInput'),
  addTenderSupplierBtn: document.getElementById('addTenderSupplierBtn'),
  selectedTenderSuppliers: document.getElementById('selectedTenderSuppliers'),
  tenderStagesPreview: document.getElementById('tenderStagesPreview'),
  supplierSuggestions: document.getElementById('supplierSuggestions'),

  dateModal: document.getElementById('dateModal'),
  dateModalTitle: document.getElementById('dateModalTitle'),
  dateModalCaption: document.getElementById('dateModalCaption'),
  quickDateInput: document.getElementById('quickDateInput'),
  saveQuickDateBtn: document.getElementById('saveQuickDateBtn'),
  syncToast: document.getElementById('syncToast')
};

const state = {
  activeTab: 'documents',
  activeMonth: currentMonth(),
  documents: [],
  tenders: [],
  supplierNames: [],
  documentEditId: null,
  duplicateDocument: null,
  editingTargetYear: null,
  tenderEditId: null,
  selectedTenderSuppliers: [],
  quickDateContext: null
};

bindEvents();
elements.activeMonth.value = state.activeMonth;
updateNextYearLabel();
renderTenderStagePreview();
initializeApp();

async function initializeApp() {
  const results = await Promise.allSettled([
    loadAndMigrateDocuments(),
    fetchTenderDecisions(),
    fetchSupplierNames()
  ]);

  const documentResult = results[0];
  const tenderResult = results[1];
  const supplierResult = results[2];

  if (documentResult.status === 'fulfilled') {
    state.documents = documentResult.value.documents;
    if (documentResult.value.migratedCount > 0) {
      showToast(`Данные перенесены в базу: ${documentResult.value.migratedCount}`);
    }
  } else {
    console.error('Document load failed:', documentResult.reason);
    state.documents = loadLocalBackup(DOCUMENT_STORAGE_KEY).map(normalizeDocument);
    showToast('Нет связи с базой. Показана локальная копия документов.', 'error', 6500);
  }

  if (tenderResult.status === 'fulfilled') {
    state.tenders = tenderResult.value;
  } else {
    console.error('Tender load failed:', tenderResult.reason);
    state.tenders = loadLocalBackup(TENDER_STORAGE_KEY).map(normalizeTenderDecision);
    showToast('Не удалось загрузить тендерные решения.', 'error', 6500);
  }

  if (supplierResult.status === 'fulfilled') {
    state.supplierNames = supplierResult.value;
  }

  refreshSupplierSuggestions();
  saveLocalBackups();
  renderDocuments();
  renderTenderDecisions();
}

function bindEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  elements.openCreateBtn.addEventListener('click', () => {
    if (state.activeTab === 'documents') {
      openDocumentModal();
    } else {
      openTenderModal();
    }
  });

  elements.searchToggles.forEach((button) => {
    button.addEventListener('click', () => toggleQuickSearch(button));
  });

  elements.prevMonthBtn.addEventListener('click', () => shiftMonth(-1));
  elements.nextMonthBtn.addEventListener('click', () => shiftMonth(1));
  elements.activeMonth.addEventListener('change', () => {
    state.activeMonth = elements.activeMonth.value || currentMonth();
    renderDocuments();
  });
  elements.documentStatusFilter.addEventListener('change', renderDocuments);
  elements.documentSearch.addEventListener('input', renderDocuments);
  elements.tenderStatusFilter.addEventListener('change', renderTenderDecisions);
  elements.tenderSearch.addEventListener('input', renderTenderDecisions);

  elements.documentForm.addEventListener('submit', submitDocument);
  elements.tenderForm.addEventListener('submit', submitTenderDecision);
  elements.tenderAmount.addEventListener('input', renderTenderStagePreview);
  elements.addTenderSupplierBtn.addEventListener('click', addSupplierFromInput);
  elements.tenderSupplierInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addSupplierFromInput();
    }
  });
  elements.selectedTenderSuppliers.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-supplier]');
    if (!button) return;
    const index = Number(button.dataset.removeSupplier);
    state.selectedTenderSuppliers.splice(index, 1);
    renderSelectedTenderSuppliers();
  });

  elements.documentsList.addEventListener('click', handleDocumentListClick);
  elements.tendersList.addEventListener('click', handleTenderListClick);
  elements.saveQuickDateBtn.addEventListener('click', saveQuickDate);

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal.id);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openModalElement = document.querySelector('.modal.open');
    if (openModalElement) {
      closeModal(openModalElement.id);
      return;
    }
    closeEmptySearches();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-quick-search]')) {
      closeEmptySearches();
    }
  });
}

function switchTab(tabName) {
  if (!['documents', 'tenders'].includes(tabName)) return;
  state.activeTab = tabName;

  elements.tabs.forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === tabName);
  });
  elements.views.forEach((view) => {
    const isActive = view.dataset.view === tabName;
    view.hidden = !isActive;
    view.classList.toggle('is-active', isActive);
  });
  elements.headerControlGroups.forEach((group) => {
    group.hidden = group.dataset.headerControls !== tabName;
  });
  closeEmptySearches();

  const isDocuments = tabName === 'documents';
  elements.brandCaption.textContent = isDocuments
    ? 'Документы по месяцам'
    : 'Тендерные решения';
  elements.openCreateLabel.textContent = isDocuments ? 'Документ' : 'Решение';
  elements.openCreateBtn.setAttribute(
    'aria-label',
    isDocuments ? 'Добавить документ' : 'Добавить тендерное решение'
  );
}

function toggleQuickSearch(button) {
  const wrapper = button.closest('[data-quick-search]');
  const input = document.getElementById(button.dataset.searchToggle);
  if (!wrapper || !input) return;
  const shouldOpen = !wrapper.classList.contains('is-open');

  document.querySelectorAll('[data-quick-search].is-open').forEach((item) => {
    if (item !== wrapper && !item.querySelector('input')?.value) {
      item.classList.remove('is-open');
      item.querySelector('[data-search-toggle]')?.setAttribute('aria-expanded', 'false');
    }
  });

  wrapper.classList.toggle('is-open', shouldOpen);
  button.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) {
    setTimeout(() => input.focus(), 0);
  } else if (input.value) {
    input.focus();
  }
}

function closeEmptySearches(force = false) {
  document.querySelectorAll('[data-quick-search].is-open').forEach((wrapper) => {
    const input = wrapper.querySelector('input');
    if (!force && input?.value) return;
    wrapper.classList.remove('is-open');
    wrapper.querySelector('[data-search-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

function openModal(modal) {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.open')) {
    document.body.style.overflow = '';
  }

  if (modalId === 'documentModal') {
    state.documentEditId = null;
    state.duplicateDocument = null;
    state.editingTargetYear = null;
    elements.documentForm.reset();
  }
  if (modalId === 'tenderModal') {
    state.tenderEditId = null;
    state.selectedTenderSuppliers = [];
    elements.tenderForm.reset();
    renderSelectedTenderSuppliers();
    renderTenderStagePreview();
  }
  if (modalId === 'dateModal') {
    state.quickDateContext = null;
    elements.quickDateInput.value = '';
  }
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDate(dateValue, days) {
  const normalized = toDateInputValue(dateValue);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function defaultApprovalDate() {
  return addDaysToDate(todayDate(), 10);
}

function toDateInputValue(value) {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function formatDate(value) {
  const normalized = toDateInputValue(value);
  if (!normalized) return '—';
  const [year, month, day] = normalized.split('-');
  return `${day}.${month}.${year}`;
}

function formatMonthLabel(monthValue) {
  const [year, month] = String(monthValue).split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
}

function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2
  }).format(Number(value || 0));
}

function isPastDate(value) {
  const normalized = toDateInputValue(value);
  return Boolean(normalized && normalized < todayDate());
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const clean = String(value || '').trim();
    const key = clean.toLocaleLowerCase('ru-RU');
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function documentStatusFromStage(stage) {
  if (typeof stage === 'string' && DOCUMENT_STEPS.some((item) => item.key === stage)) {
    return stage;
  }
  return DOCUMENT_STEPS[Number(stage)]?.key || 'mine';
}

function documentStageFromStatus(status) {
  const index = DOCUMENT_STEPS.findIndex((item) => item.key === status);
  return index >= 0 ? index : 0;
}

function normalizeDocument(doc = {}) {
  const targetYear = doc.targetYear === null || doc.targetYear === undefined || doc.targetYear === ''
    ? null
    : Number(doc.targetYear);

  return {
    id: doc.id || crypto.randomUUID(),
    month: doc.month || currentMonth(),
    applicationNumber: doc.applicationNumber ?? doc.appendixNumber ?? '',
    projectName: doc.projectName || '',
    counterparty: doc.counterparty || '',
    internalNumber: doc.internalNumber || '',
    tenderNumber: doc.tenderNumber || '',
    status: doc.status || documentStatusFromStage(doc.stage),
    inMkt: targetYear ? false : Boolean(doc.inMkt),
    targetYear: Number.isInteger(targetYear) ? targetYear : null,
    comment: doc.comment || '',
    approvalDate: toDateInputValue(doc.approvalDate),
    approvalDeadline: doc.approvalDeadline || null,
    approvedStartedAt: doc.approvedStartedAt || null,
    createdAt: doc.createdAt || new Date().toISOString(),
    updatedAt: doc.updatedAt || null
  };
}

function toApiDocument(doc) {
  return {
    id: doc.id,
    month: doc.month,
    appendixNumber: doc.applicationNumber || '',
    projectName: doc.projectName,
    counterparty: doc.counterparty,
    internalNumber: doc.internalNumber || '',
    tenderNumber: doc.tenderNumber || '',
    stage: documentStageFromStatus(doc.status),
    inMkt: doc.targetYear ? false : Boolean(doc.inMkt),
    targetYear: doc.targetYear || null,
    comment: doc.comment || '',
    approvalDate: doc.approvalDate || null,
    approvalDeadline: doc.approvalDate || null,
    approvedStartedAt: doc.approvedStartedAt || null
  };
}

function getTenderStages(amountInput) {
  const amount = Number(amountInput || 0);
  let keys;
  if (amount < 1_000_000) {
    keys = ['mine', 'yulia_ivan'];
  } else if (amount < 3_000_000) {
    keys = ['mine', 'yulia_ivan', 'finance'];
  } else if (amount < 7_000_000) {
    keys = ['mine', 'yulia_ivan', 'olya_k', 'yulia_d', 'paperwork'];
  } else {
    keys = ['mine', 'yulia_ivan', 'olya_k', 'yulia_d', 'mikhail', 'paperwork'];
  }
  return keys.map((key) => ({ key, label: TENDER_STAGE_LABELS[key] }));
}

function normalizeTenderDecision(decision = {}) {
  const amount = Number(decision.amount || 0);
  return {
    id: decision.id || crypto.randomUUID(),
    number: decision.number || '',
    title: decision.title || '',
    validFrom: toDateInputValue(decision.validFrom),
    validTo: toDateInputValue(decision.validTo),
    amount,
    suppliers: uniqueStrings(decision.suppliers),
    comment: decision.comment || '',
    currentStage: decision.currentStage || 'mine',
    stages: getTenderStages(amount),
    stageStartedOn: toDateInputValue(decision.stageStartedOn),
    stageDeadline: toDateInputValue(decision.stageDeadline),
    yuliaApproved: Boolean(decision.yuliaApproved),
    ivanApproved: Boolean(decision.ivanApproved),
    isReady: decision.currentStage === 'completed' || Boolean(decision.isReady),
    createdAt: decision.createdAt || new Date().toISOString(),
    updatedAt: decision.updatedAt || null
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Ошибка сервера: ${response.status}`);
  }
  return payload;
}

async function loadAndMigrateDocuments() {
  let remoteDocuments = await requestJson(API_DOCUMENTS);
  remoteDocuments = Array.isArray(remoteDocuments)
    ? remoteDocuments.map(normalizeDocument)
    : [];

  const localDocuments = loadLocalBackup(DOCUMENT_STORAGE_KEY).map(normalizeDocument);
  const remoteIds = new Set(remoteDocuments.map((doc) => doc.id));
  const remoteSignatures = new Set(remoteDocuments.map(documentSignature));
  let migratedCount = 0;

  for (const localDocument of localDocuments) {
    const signature = documentSignature(localDocument);
    if (remoteIds.has(localDocument.id) || remoteSignatures.has(signature)) continue;
    try {
      const saved = await saveDocumentToServer(localDocument);
      remoteDocuments.push(saved);
      remoteIds.add(saved.id);
      remoteSignatures.add(documentSignature(saved));
      migratedCount += 1;
    } catch (error) {
      console.warn('Could not migrate local document:', localDocument, error);
    }
  }

  const freshDocuments = await requestJson(API_DOCUMENTS);
  return {
    documents: Array.isArray(freshDocuments) ? freshDocuments.map(normalizeDocument) : remoteDocuments,
    migratedCount
  };
}

function documentSignature(doc) {
  return [
    doc.month,
    doc.applicationNumber,
    doc.projectName,
    doc.counterparty,
    doc.internalNumber
  ]
    .map((value) => String(value || '').trim().toLocaleLowerCase('ru-RU'))
    .join('|');
}

async function fetchTenderDecisions() {
  const rows = await requestJson(API_TENDERS);
  return Array.isArray(rows) ? rows.map(normalizeTenderDecision) : [];
}

async function fetchSupplierNames() {
  const names = await requestJson(API_SUPPLIERS);
  return uniqueStrings(names).sort((a, b) => a.localeCompare(b, 'ru'));
}

async function saveDocumentToServer(doc) {
  const saved = await requestJson(API_DOCUMENTS, {
    method: 'POST',
    body: JSON.stringify(toApiDocument(doc))
  });
  return normalizeDocument(saved);
}

async function saveTenderToServer(decision) {
  const saved = await requestJson(API_TENDERS, {
    method: 'POST',
    body: JSON.stringify(decision)
  });
  return normalizeTenderDecision(saved);
}

function loadLocalBackup(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveLocalBackups() {
  localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify(state.documents));
  localStorage.setItem(TENDER_STORAGE_KEY, JSON.stringify(state.tenders));
}

function refreshSupplierSuggestions() {
  const allNames = uniqueStrings([
    ...state.supplierNames,
    ...state.documents.map((doc) => doc.counterparty),
    ...state.tenders.flatMap((decision) => decision.suppliers)
  ]).sort((a, b) => a.localeCompare(b, 'ru'));

  state.supplierNames = allNames;
  elements.supplierSuggestions.innerHTML = allNames
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
}

function replaceDocument(savedDocument) {
  const index = state.documents.findIndex((doc) => doc.id === savedDocument.id);
  if (index >= 0) {
    state.documents[index] = savedDocument;
  } else {
    state.documents.unshift(savedDocument);
  }
  saveLocalBackups();
}

function replaceTenderDecision(savedDecision) {
  const index = state.tenders.findIndex((decision) => decision.id === savedDecision.id);
  if (index >= 0) {
    state.tenders[index] = savedDecision;
  } else {
    state.tenders.unshift(savedDecision);
  }
  sortTenderDecisions();
  saveLocalBackups();
}

function sortTenderDecisions() {
  state.tenders.sort((a, b) => {
    if (a.isReady !== b.isReady) return a.isReady ? 1 : -1;
    const deadlineCompare = String(a.stageDeadline || '9999').localeCompare(String(b.stageDeadline || '9999'));
    if (deadlineCompare !== 0) return deadlineCompare;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

function shiftMonth(delta) {
  const [year, month] = state.activeMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  state.activeMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  elements.activeMonth.value = state.activeMonth;
  renderDocuments();
}

function updateNextYearLabel(year = null) {
  const targetYear = year || new Date().getFullYear() + 1;
  elements.nextYearLabel.textContent = `Документ на ${targetYear} год`;
}

function openDocumentModal(id = null, duplicate = null) {
  state.documentEditId = id;
  state.duplicateDocument = duplicate ? { ...duplicate } : null;
  state.editingTargetYear = null;
  elements.documentForm.reset();

  const source = id
    ? state.documents.find((doc) => doc.id === id)
    : duplicate;

  elements.documentMonth.value = duplicate
    ? monthWithOffset(duplicate.month, 1)
    : source?.month || state.activeMonth;
  elements.appendixNumber.value = source?.applicationNumber || '';
  elements.projectName.value = source?.projectName || '';
  elements.counterparty.value = source?.counterparty || '';
  elements.internalNumber.value = source?.internalNumber || '';
  elements.tenderNumber.value = source?.tenderNumber || '';
  elements.documentApprovalDate.value = source?.approvalDate || defaultApprovalDate();
  elements.documentStatus.value = source?.status || 'mine';
  elements.documentComment.value = source?.comment || '';

  const targetYear = source?.targetYear || null;
  state.editingTargetYear = targetYear;
  elements.nextYearDocument.checked = Boolean(targetYear);
  updateNextYearLabel(targetYear);

  elements.documentModalTitle.textContent = id
    ? 'Редактировать документ'
    : duplicate
      ? 'Копировать документ'
      : 'Новый документ';

  openModal(elements.documentModal);
  setTimeout(() => {
    const focusTarget = duplicate ? elements.appendixNumber : elements.documentMonth;
    focusTarget.focus();
    if (duplicate) elements.appendixNumber.select();
  }, 0);
}

function monthWithOffset(monthValue, delta) {
  const [year, month] = String(monthValue || currentMonth()).split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function submitDocument(event) {
  event.preventDefault();
  const submitButton = elements.documentForm.querySelector('button[type="submit"]');
  const existing = state.documentEditId
    ? state.documents.find((doc) => doc.id === state.documentEditId)
    : null;
  const targetYear = elements.nextYearDocument.checked
    ? state.editingTargetYear || state.duplicateDocument?.targetYear || new Date().getFullYear() + 1
    : null;

  const documentToSave = normalizeDocument({
    id: state.documentEditId || crypto.randomUUID(),
    month: elements.documentMonth.value,
    applicationNumber: elements.appendixNumber.value.trim(),
    projectName: elements.projectName.value.trim(),
    counterparty: elements.counterparty.value.trim(),
    internalNumber: elements.internalNumber.value.trim(),
    tenderNumber: elements.tenderNumber.value.trim(),
    approvalDate: elements.documentApprovalDate.value || defaultApprovalDate(),
    status: elements.documentStatus.value,
    targetYear,
    comment: elements.documentComment.value.trim(),
    inMkt: targetYear
      ? false
      : existing?.inMkt ?? state.duplicateDocument?.inMkt ?? false,
    approvedStartedAt: existing?.approvedStartedAt || null,
    createdAt: existing?.createdAt || new Date().toISOString()
  });

  submitButton.disabled = true;
  submitButton.textContent = 'Сохраняем…';
  try {
    const saved = await saveDocumentToServer(documentToSave);
    replaceDocument(saved);
    state.activeMonth = saved.month;
    elements.activeMonth.value = saved.month;
    closeModal('documentModal');
    refreshSupplierSuggestions();
    renderDocuments();
    showToast(existing ? 'Документ обновлён' : 'Документ сохранён');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось сохранить документ.', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Сохранить';
  }
}

function renderDocuments() {
  const query = elements.documentSearch.value.trim().toLocaleLowerCase('ru-RU');
  const statusFilter = elements.documentStatusFilter.value;
  const filtered = state.documents.filter((doc) => {
    if (doc.month !== state.activeMonth) return false;
    if (statusFilter === 'active' && doc.status === 'approved') return false;
    if (statusFilter === 'approved' && doc.status !== 'approved') return false;
    if (!query) return true;
    return [
      doc.applicationNumber,
      doc.projectName,
      doc.counterparty,
      doc.internalNumber,
      doc.tenderNumber,
      doc.comment
    ]
      .join(' ')
      .toLocaleLowerCase('ru-RU')
      .includes(query);
  });

  if (!filtered.length) {
    elements.documentsList.innerHTML = `
      <div class="empty-state">За ${escapeHtml(formatMonthLabel(state.activeMonth))} документов не найдено.</div>
    `;
    return;
  }

  elements.documentsList.innerHTML = filtered.map((doc) => {
    const deadlineLabel = doc.status === 'review' && doc.approvalDate
      ? `Согласовать до ${formatDate(doc.approvalDate)}`
      : '';
    const decisionPending = (doc.tenderNumber || '').toLocaleLowerCase('ru-RU').includes('соглас');
    const metaParts = [
      `<span>Контрагент: ${escapeHtml(doc.counterparty || '—')}</span>`,
      decisionPending ? '' : `<span>Решение: ${escapeHtml(doc.tenderNumber || '—')}</span>`,
      `<span>Внутренний номер: ${escapeHtml(doc.internalNumber || '—')}</span>`
    ].filter(Boolean).join('');

    return `
      <article class="doc-row" data-document-id="${escapeHtml(doc.id)}">
        <div class="doc-main">
          <div class="doc-title-line">
            <span class="doc-number">Приложение ${escapeHtml(doc.applicationNumber)}</span>
            <span class="doc-project">${escapeHtml(doc.projectName)}</span>
          </div>
          <div class="doc-meta">
            ${metaParts}
            ${decisionPending ? '<span class="decision-alert">Решение на согласовании</span>' : ''}
          </div>
          ${doc.comment ? `
            <div class="comment-block">
              <button class="comment-toggle" type="button" data-action="toggle-comment" aria-expanded="false">Комментарий</button>
              <div class="comment-body">${escapeHtml(doc.comment)}</div>
            </div>
          ` : ''}
        </div>
        <div class="doc-side">
          <div class="steps-wrap">
            <div class="steps-deadline">
              ${deadlineLabel ? `<button class="approval-date-chip" type="button" data-action="edit-document-date">${deadlineLabel}</button>` : ''}
            </div>
            <div class="steps">${renderDocumentSteps(doc)}</div>
          </div>
          ${doc.targetYear
            ? `<span class="next-year-pill">На ${escapeHtml(doc.targetYear)} год</span>`
            : `
              <button class="mkt-pill ${doc.inMkt ? 'is-active' : ''}" type="button" data-action="toggle-mkt">
                <span class="mkt-icon">₽</span>
                <span>В МКТ</span>
              </button>
            `}
        </div>
        <div class="row-actions">
          <button class="mini-btn" type="button" data-action="duplicate" aria-label="Копировать" title="Копировать">⧉</button>
          <button class="mini-btn" type="button" data-action="edit" aria-label="Редактировать" title="Редактировать">✎</button>
          <button class="mini-btn delete" type="button" data-action="delete" aria-label="Удалить" title="Удалить">✕</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderDocumentSteps(doc) {
  const currentIndex = DOCUMENT_STEPS.findIndex((step) => step.key === doc.status);
  return DOCUMENT_STEPS.map((step, index) => {
    let className = 'step';
    if (index < currentIndex || doc.status === 'approved') className += ' is-done';
    if (index === currentIndex && doc.status !== 'approved') className += ' is-current';
    return `
      <button class="${className}" type="button" data-action="set-document-status" data-status="${step.key}">
        ${step.label}
      </button>
    `;
  }).join('');
}

async function handleDocumentListClick(event) {
  const button = event.target.closest('[data-action]');
  const row = event.target.closest('[data-document-id]');
  if (!button || !row) return;
  const doc = state.documents.find((item) => item.id === row.dataset.documentId);
  if (!doc) return;
  const action = button.dataset.action;

  if (action === 'toggle-comment') {
    const block = button.closest('.comment-block');
    const isOpen = block.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
    return;
  }
  if (action === 'duplicate') {
    openDocumentModal(null, doc);
    return;
  }
  if (action === 'edit') {
    openDocumentModal(doc.id);
    return;
  }
  if (action === 'edit-document-date') {
    openQuickDate({
      type: 'document',
      id: doc.id,
      value: doc.approvalDate || defaultApprovalDate(),
      title: 'Срок согласования',
      caption: doc.projectName
    });
    return;
  }
  if (action === 'delete') {
    if (!confirm('Удалить документ? Это действие нельзя отменить.')) return;
    await runButtonAction(button, async () => {
      await requestJson(`${API_DOCUMENTS}/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      state.documents = state.documents.filter((item) => item.id !== doc.id);
      saveLocalBackups();
      renderDocuments();
      showToast('Документ удалён');
    });
    return;
  }
  if (action === 'toggle-mkt') {
    await runButtonAction(button, async () => {
      const saved = await saveDocumentToServer({ ...doc, inMkt: !doc.inMkt });
      replaceDocument(saved);
      renderDocuments();
    });
    return;
  }
  if (action === 'set-document-status') {
    const nextStatus = button.dataset.status;
    if (nextStatus === doc.status) return;
    await runButtonAction(button, async () => {
      const saved = await saveDocumentToServer({
        ...doc,
        status: nextStatus,
        approvalDate: nextStatus === 'review' && !doc.approvalDate
          ? defaultApprovalDate()
          : doc.approvalDate
      });
      replaceDocument(saved);
      renderDocuments();
    });
  }
}

function openTenderModal(id = null) {
  state.tenderEditId = id;
  state.selectedTenderSuppliers = [];
  elements.tenderForm.reset();

  const decision = id
    ? state.tenders.find((item) => item.id === id)
    : null;

  elements.tenderDecisionNumber.value = decision?.number || '';
  elements.tenderAmount.value = decision ? String(decision.amount) : '';
  elements.tenderTitle.value = decision?.title || '';
  elements.tenderValidFrom.value = decision?.validFrom || '';
  elements.tenderValidTo.value = decision?.validTo || '';
  elements.tenderComment.value = decision?.comment || '';
  state.selectedTenderSuppliers = [...(decision?.suppliers || [])];
  elements.tenderModalTitle.textContent = decision
    ? 'Редактировать тендерное решение'
    : 'Новое тендерное решение';

  renderSelectedTenderSuppliers();
  renderTenderStagePreview();
  openModal(elements.tenderModal);
  setTimeout(() => elements.tenderDecisionNumber.focus(), 0);
}

function addSupplierFromInput() {
  const value = elements.tenderSupplierInput.value.trim();
  if (!value) return;
  const exists = state.selectedTenderSuppliers.some(
    (name) => name.toLocaleLowerCase('ru-RU') === value.toLocaleLowerCase('ru-RU')
  );
  if (!exists) state.selectedTenderSuppliers.push(value);
  elements.tenderSupplierInput.value = '';
  renderSelectedTenderSuppliers();
  elements.tenderSupplierInput.focus();
}

function renderSelectedTenderSuppliers() {
  if (!state.selectedTenderSuppliers.length) {
    elements.selectedTenderSuppliers.innerHTML = '';
    return;
  }
  elements.selectedTenderSuppliers.innerHTML = state.selectedTenderSuppliers
    .map((name, index) => `
      <span class="selected-supplier">
        ${escapeHtml(name)}
        <button type="button" data-remove-supplier="${index}" aria-label="Убрать ${escapeHtml(name)}">✕</button>
      </span>
    `)
    .join('');
}

function renderTenderStagePreview() {
  const stages = getTenderStages(elements.tenderAmount.value);
  elements.tenderStagesPreview.innerHTML = stages
    .map((stage, index) => `
      ${index ? '<span class="preview-arrow">→</span>' : ''}
      <span class="preview-step">${stage.label}</span>
    `)
    .join('');
}

async function submitTenderDecision(event) {
  event.preventDefault();
  if (elements.tenderSupplierInput.value.trim()) {
    addSupplierFromInput();
  }
  if (!state.selectedTenderSuppliers.length) {
    showToast('Добавьте хотя бы одного поставщика.', 'error');
    elements.tenderSupplierInput.focus();
    return;
  }

  const submitButton = elements.tenderForm.querySelector('button[type="submit"]');
  const existing = state.tenderEditId
    ? state.tenders.find((decision) => decision.id === state.tenderEditId)
    : null;
  const payload = {
    id: state.tenderEditId || crypto.randomUUID(),
    number: elements.tenderDecisionNumber.value.trim(),
    title: elements.tenderTitle.value.trim(),
    amount: Number(elements.tenderAmount.value),
    validFrom: elements.tenderValidFrom.value,
    validTo: elements.tenderValidTo.value,
    suppliers: [...state.selectedTenderSuppliers],
    comment: elements.tenderComment.value.trim(),
    currentStage: existing?.currentStage || 'mine',
    stageStartedOn: existing?.stageStartedOn || null,
    stageDeadline: existing?.stageDeadline || null,
    yuliaApproved: existing?.yuliaApproved || false,
    ivanApproved: existing?.ivanApproved || false
  };

  submitButton.disabled = true;
  submitButton.textContent = 'Сохраняем…';
  try {
    const saved = await saveTenderToServer(payload);
    replaceTenderDecision(saved);
    closeModal('tenderModal');
    refreshSupplierSuggestions();
    renderTenderDecisions();
    showToast(existing ? 'Тендерное решение обновлено' : 'Тендерное решение сохранено');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось сохранить тендерное решение.', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Сохранить';
  }
}

function renderTenderDecisions() {
  const query = elements.tenderSearch.value.trim().toLocaleLowerCase('ru-RU');
  const filter = elements.tenderStatusFilter.value;
  const filtered = state.tenders.filter((decision) => {
    if (filter === 'ready' && !decision.isReady) return false;
    if (query && !decision.title.toLocaleLowerCase('ru-RU').includes(query)) return false;
    return true;
  });

  if (!filtered.length) {
    elements.tendersList.innerHTML = `
      <div class="empty-state">Тендерных решений по выбранному фильтру не найдено.</div>
    `;
    return;
  }

  elements.tendersList.innerHTML = filtered
    .map(renderTenderDecisionCard)
    .join('');
}

function renderTenderDecisionCard(decision) {
  const stages = getTenderStages(decision.amount);
  const currentIndex = decision.currentStage === 'completed'
    ? stages.length
    : stages.findIndex((stage) => stage.key === decision.currentStage);
  const overdue = !decision.isReady && isPastDate(decision.stageDeadline);

  const stepsHtml = stages.map((stage, index) => {
    const classes = ['tender-step'];
    const isCurrent = !decision.isReady && index === currentIndex;
    if (decision.isReady || index < currentIndex) classes.push('is-done');
    if (isCurrent) classes.push('is-current');
    if (overdue && isCurrent) classes.push('is-overdue');
    if (stage.key === 'yulia_ivan') classes.push('joint-stage');

    const deadline = isCurrent && decision.stageDeadline
      ? `
        <button
          class="stage-deadline-inline ${overdue ? 'is-overdue' : ''}"
          type="button"
          data-action="edit-tender-deadline"
          title="Изменить срок текущего этапа"
        >${overdue ? 'просрочено' : 'до'} ${formatDate(decision.stageDeadline)}</button>
      `
      : '';

    if (stage.key === 'yulia_ivan') {
      return `
        <div class="${classes.join(' ')}">
          ${deadline}
          <div class="joint-stage-content">
            <button
              class="tender-step-main"
              type="button"
              data-action="set-tender-stage"
              data-stage="${stage.key}"
              title="Сделать текущим этапом"
            >Юля / Иван</button>
            <div class="joint-checks" aria-label="Отдельные согласования Юли и Ивана">
              <button
                class="joint-person ${decision.yuliaApproved ? 'is-approved' : ''}"
                type="button"
                data-action="toggle-yulia"
                aria-label="${decision.yuliaApproved ? 'Снять согласование Юли' : 'Отметить согласование Юли'}"
              ><span aria-hidden="true">${decision.yuliaApproved ? '✓' : ''}</span>Юля</button>
              <button
                class="joint-person ${decision.ivanApproved ? 'is-approved' : ''}"
                type="button"
                data-action="toggle-ivan"
                aria-label="${decision.ivanApproved ? 'Снять согласование Ивана' : 'Отметить согласование Ивана'}"
              ><span aria-hidden="true">${decision.ivanApproved ? '✓' : ''}</span>Иван</button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="${classes.join(' ')}">
        ${deadline}
        <button
          class="tender-step-main"
          type="button"
          data-action="set-tender-stage"
          data-stage="${stage.key}"
          title="Сделать текущим этапом"
        >${stage.label}</button>
      </div>
    `;
  }).join('');

  const supplierTags = decision.suppliers
    .map((name) => `<span class="supplier-tag">${escapeHtml(name)}</span>`)
    .join('');

  return `
    <article
      class="tender-card ${overdue ? 'is-overdue' : ''} ${decision.isReady ? 'is-ready' : ''}"
      data-tender-id="${escapeHtml(decision.id)}"
    >
      <div class="tender-head">
        <div class="tender-summary">
          <div class="tender-primary-line">
            <span class="tender-number">№ ${escapeHtml(decision.number)}</span>
            <h2 class="tender-title" title="${escapeHtml(decision.title)}">${escapeHtml(decision.title)}</h2>
            <span class="tender-validity">${formatDate(decision.validFrom)} — ${formatDate(decision.validTo)}</span>
            ${decision.isReady ? '<span class="ready-badge">Готово</span>' : ''}
            ${overdue ? '<span class="overdue-badge">Срок прошёл</span>' : ''}
          </div>
          <div class="tender-secondary-line">
            <div class="supplier-list-inline">${supplierTags}</div>
            ${decision.comment ? `
              <div class="comment-block tender-comment-block">
                <button class="comment-toggle" type="button" data-action="toggle-tender-comment" aria-expanded="false">Комментарий</button>
                <div class="comment-body">${escapeHtml(decision.comment)}</div>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="tender-amount">${escapeHtml(formatMoney(decision.amount))}</div>
        <div class="row-actions">
          <button class="mini-btn" type="button" data-action="edit-tender" aria-label="Редактировать" title="Редактировать">✎</button>
          <button class="mini-btn delete" type="button" data-action="delete-tender" aria-label="Удалить" title="Удалить">✕</button>
        </div>
      </div>

      <div class="tender-progress">
        <div class="tender-steps">
          ${stepsHtml}
          <div class="tender-step is-ready-step ${decision.isReady ? 'is-current' : ''}">
            <button
              class="tender-step-main"
              type="button"
              data-action="set-tender-stage"
              data-stage="completed"
              title="Отметить решение готовым"
            >Готово</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

async function handleTenderListClick(event) {
  const button = event.target.closest('[data-action]');
  const card = event.target.closest('[data-tender-id]');
  if (!button || !card) return;
  const decision = state.tenders.find((item) => item.id === card.dataset.tenderId);
  if (!decision) return;
  const action = button.dataset.action;

  if (action === 'toggle-tender-comment') {
    const block = button.closest('.comment-block');
    if (!block) return;
    const isOpen = block.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
    return;
  }
  if (action === 'edit-tender') {
    openTenderModal(decision.id);
    return;
  }
  if (action === 'delete-tender') {
    if (!confirm('Удалить тендерное решение? Это действие нельзя отменить.')) return;
    await runButtonAction(button, async () => {
      await requestJson(`${API_TENDERS}/${encodeURIComponent(decision.id)}`, { method: 'DELETE' });
      state.tenders = state.tenders.filter((item) => item.id !== decision.id);
      saveLocalBackups();
      renderTenderDecisions();
      showToast('Тендерное решение удалено');
    });
    return;
  }
  if (action === 'edit-tender-deadline') {
    openQuickDate({
      type: 'tender',
      id: decision.id,
      value: decision.stageDeadline,
      title: 'Срок текущего этапа',
      caption: `${decision.title} · ${TENDER_STAGE_LABELS[decision.currentStage] || ''}`
    });
    return;
  }
  if (action === 'toggle-yulia' || action === 'toggle-ivan') {
    const update = {
      ...decision,
      yuliaApproved: action === 'toggle-yulia'
        ? !decision.yuliaApproved
        : decision.yuliaApproved,
      ivanApproved: action === 'toggle-ivan'
        ? !decision.ivanApproved
        : decision.ivanApproved
    };
    await runButtonAction(button, async () => {
      const saved = await saveTenderToServer(update);
      replaceTenderDecision(saved);
      renderTenderDecisions();
    });
    return;
  }
  if (action === 'set-tender-stage') {
    const targetStage = button.dataset.stage;
    if (targetStage === decision.currentStage) return;
    const stages = getTenderStages(decision.amount).map((stage) => stage.key);
    const currentIndex = decision.currentStage === 'completed'
      ? stages.length
      : stages.indexOf(decision.currentStage);
    const targetIndex = targetStage === 'completed'
      ? stages.length
      : stages.indexOf(targetStage);

    if (targetIndex > currentIndex + 1) {
      showToast('Переходите на следующий этап по порядку.', 'error');
      return;
    }

    const jointIndex = stages.indexOf('yulia_ivan');
    if (
      targetIndex > jointIndex &&
      currentIndex <= jointIndex &&
      (!decision.yuliaApproved || !decision.ivanApproved)
    ) {
      showToast('Сначала отметьте согласование Юли и Ивана.', 'error');
      return;
    }

    await runButtonAction(button, async () => {
      const saved = await saveTenderToServer({
        ...decision,
        currentStage: targetStage,
        stageDeadline: null
      });
      replaceTenderDecision(saved);
      renderTenderDecisions();
      showToast(targetStage === 'completed' ? 'Решение отмечено готовым' : 'Новый этап запущен');
    });
  }
}

function openQuickDate(context) {
  state.quickDateContext = context;
  elements.dateModalTitle.textContent = context.title;
  elements.dateModalCaption.textContent = context.caption;
  elements.quickDateInput.value = toDateInputValue(context.value) || todayDate();
  openModal(elements.dateModal);
  setTimeout(() => elements.quickDateInput.focus(), 0);
}

async function saveQuickDate() {
  const context = state.quickDateContext;
  const value = elements.quickDateInput.value;
  if (!context || !value) return;

  elements.saveQuickDateBtn.disabled = true;
  elements.saveQuickDateBtn.textContent = 'Сохраняем…';
  try {
    if (context.type === 'document') {
      const doc = state.documents.find((item) => item.id === context.id);
      if (!doc) return;
      const saved = await saveDocumentToServer({ ...doc, approvalDate: value });
      replaceDocument(saved);
      renderDocuments();
    } else {
      const decision = state.tenders.find((item) => item.id === context.id);
      if (!decision) return;
      const saved = await saveTenderToServer({ ...decision, stageDeadline: value });
      replaceTenderDecision(saved);
      renderTenderDecisions();
    }
    closeModal('dateModal');
    showToast('Дата сохранена');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось сохранить дату.', 'error');
  } finally {
    elements.saveQuickDateBtn.disabled = false;
    elements.saveQuickDateBtn.textContent = 'Сохранить';
  }
}

async function runButtonAction(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Не удалось сохранить изменение.', 'error');
    button.disabled = false;
  }
}

function showToast(message, type = 'success', duration = 3200) {
  elements.syncToast.textContent = message;
  elements.syncToast.className = `sync-toast ${type} show`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.syncToast.classList.remove('show');
  }, duration);
}
