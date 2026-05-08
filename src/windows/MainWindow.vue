<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient, type ChatMessage, type CallMetadata } from '../utils/aiClient';
import { useSettingsStore } from '../stores/settings';
import { useHistoryStore, toHistoryMessages } from '../stores/history';
import { useProjectStore, PROJECT_COLORS, type Project } from '../stores/projects';
import { useUsageStore } from '../stores/usage';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useWindow } from '../composables/useWindow';
import { recordEvent } from '../composables/useEvents';
import { saveNoteToObsidian, openNoteInObsidian } from '../utils/obsidianBridge';
import { syncZoteroLibrary } from '../utils/zoteroBridge';
import { type SearchResult } from '../utils/knowledgeBase';
import {
  getProjectStats, type ProjectStats, loadRecentConversationSummaries,
  loadZoteroCollections, type ZoteroCollection, countUnreadSentinelPapers
} from '../composables/useDatabase';
import type { CitationStyle } from '../stores/projects';
import { generateSessionSummary, shouldGenerateSummary } from '../composables/useSessionSummary';
import { open } from '@tauri-apps/plugin-dialog';
import SettingsPanel from '../components/SettingsPanel.vue';
import WelcomePanel from '../components/WelcomePanel.vue';
import ChatHeader from '../components/ChatHeader.vue';
import HistoryPanel from '../components/HistoryPanel.vue';
import KnowledgePanel from '../components/KnowledgePanel.vue';
import ChatMessageList from '../components/ChatMessageList.vue';
import ChatInputArea from '../components/ChatInputArea.vue';
import TodoPanel from '../components/TodoPanel.vue';
import LiteratureSidebar from '../components/LiteratureSidebar.vue';
import WritingHistoryPanel from '../components/WritingHistoryPanel.vue';
import SentinelPanel from '../components/SentinelPanel.vue';
import ExperimentPanel from '../components/ExperimentPanel.vue';
import DashboardPanel from '../components/DashboardPanel.vue';
import PluginPanel from '../components/PluginPanel.vue';
import TeamPanel from '../components/TeamPanel.vue';

const appWindow = getCurrentWebviewWindow();
const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();
const projectStore = useProjectStore();
const usageStore = useUsageStore();
const kbStore = useKnowledgeBaseStore();
const { setWidgetDefaultPosition, show } = useWindow();

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const isStreaming = ref(false);
const streamingText = ref('');
const showSettings = ref(false);
const showHistory = ref(false);
const showKnowledge = ref(false);
const showTodos = ref(false);
const showLiterature = ref(false);
const showWritingHistory = ref(false);
const showSentinel = ref(false);
const showExperiment = ref(false);
const showDashboard = ref(false);
const showPlugin = ref(false);
const showTeam = ref(false);
const showWelcome = ref(false);
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);

// Router metadata for each AI message (keyed by message index or timestamp)
const messageMetadata = ref<Map<number, CallMetadata>>(new Map());

// Project selector state
const showProjectDropdown = ref(false);
const showCreateProject = ref(false);
const newProjectName = ref('');
const newProjectColor = ref(PROJECT_COLORS[0]);
const showUsage = ref(false);

// Project configuration (create/edit modal)
const newProjectKeywords = ref('');
const newProjectFolderPath = ref('');
const newProjectZoteroCollection = ref('');
const newProjectObsidianVault = ref('');
const newProjectCitationStyle = ref<CitationStyle>('gb7714');
const availableZoteroCollections = ref<ZoteroCollection[]>([]);
const loadingZoteroCollections = ref(false);
const isEditingProject = ref(false);
const editProjectId = ref<string | null>(null);

// Project statistics bar
const projectStats = ref<ProjectStats>({ docCount: 0, conversationCount: 0, todoCount: 0 });
const sentinelUnreadCount = ref(0);

const loadProjectStats = async () => {
  try {
    projectStats.value = await getProjectStats(projectStore.currentProjectId);
    sentinelUnreadCount.value = await countUnreadSentinelPapers(projectStore.currentProjectId);
  } catch (e) {
    console.error('Failed to load project stats:', e);
  }
};

// Obsidian save state
const showObsidianModal = ref(false);
const obsidianContent = ref('');
const obsidianTemplate = ref<'summary' | 'full' | 'qa'>('summary');
const obsidianSaving = ref(false);
const obsidianSaveResult = ref<string | null>(null);

// Zotero periodic sync interval handle
const zoteroSyncInterval = ref<number | null>(null);

// Sentinel periodic check interval handle
const sentinelCheckInterval = ref<number | null>(null);

// Knowledge base citations for each assistant message (keyed by message index)
const kbCitations = ref<Map<number, SearchResult[]>>(new Map());

// Save messages to history when they change
watch(messages, async (newMessages) => {
  if (newMessages.length > 0) {
    await historyStore.updateCurrentMessages(toHistoryMessages(newMessages));
  }
}, { deep: true });

// Listen for show-settings event from Rust
onMounted(async () => {
  await settingsStore.init();
  showWelcome.value = !settingsStore.config.hasCompletedWelcome;

  await listen('show-settings', () => {
    showSettings.value = true;
  });

  // Phase 4.2: Listen for experiment snapshot hotkey
  await listen('experiment:show-snapshot-panel', () => {
    showExperiment.value = !showExperiment.value;
  });

  // Phase 0.1: Listen for window activity changes (for testing / future use)
  await listen('window:activity-changed', (event) => {
    console.log('[WindowActivity]', event.payload);
  });

  // Test: fetch current window info once on mount
  try {
    const info = await invoke('get_active_window_info');
    console.log('[WindowActivity] Current window:', info);
  } catch (e) {
    // Window detector may return None on non-Windows platforms
  }

  // Debug helpers for Phase 0.2 testing — exposed to browser console
  (window as any).flushEvents = () => invoke('flush_events');
  (window as any).queryEvents = async () => {
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    const db = await Database.load('sqlite:ai_research_assistant.db');
    return db.select('SELECT event_type, timestamp, duration_ms, metadata FROM activity_events ORDER BY timestamp DESC LIMIT 20');
  };

  // Load usage stats
  usageStore.loadStats('today');
  await loadProjectStats();

  // Auto-sync Zotero on startup if enabled
  if (settingsStore.config.externalTools.zoteroSyncEnabled) {
    try {
      const userId = settingsStore.config.externalTools.zoteroUserId || '0';
      const collections = settingsStore.config.externalTools.zoteroSelectedCollections;
      syncZoteroLibrary(userId, collections.length > 0 ? collections : undefined, false).catch((e) => {
        console.warn('[Zotero] Auto-sync on startup failed:', e);
      });
    } catch (e) {
      console.warn('[Zotero] Auto-sync init failed:', e);
    }
  }

  // Set up periodic Zotero sync every 30 minutes
  zoteroSyncInterval.value = window.setInterval(() => {
    if (settingsStore.config.externalTools.zoteroSyncEnabled) {
      try {
        const userId = settingsStore.config.externalTools.zoteroUserId || '0';
        const collections = settingsStore.config.externalTools.zoteroSelectedCollections;
        syncZoteroLibrary(userId, collections.length > 0 ? collections : undefined, false).catch((e) => {
          console.warn('[Zotero] Periodic sync failed:', e);
        });
      } catch (e) {
        console.warn('[Zotero] Periodic sync init failed:', e);
      }
    }
  }, 30 * 60 * 1000); // 30 minutes

  // Phase 4.1: Periodic sentinel auto-check every 6 hours
  // This runs in the background and fetches new papers for active sentinel topics
  sentinelCheckInterval.value = window.setInterval(async () => {
    try {
      const { getSentinelTopics, getSentinelPapers, createSentinelPaper, updateSentinelTopic, createSentinelCheck } = await import('../composables/useDatabase');
      const topics = await getSentinelTopics(projectStore.currentProjectId);
      const activeTopics = topics.filter((t) => t.isActive !== false);
      if (activeTopics.length === 0) return;

      for (const topic of activeTopics) {
        if (!topic.id) continue;
        const checkStartTime = Date.now();
        const arxivPapers: Array<{
          title: string; authors: string[]; summary: string; id: string; pdf_url: string; published: string; doi?: string;
        }> = await invoke('search_arxiv_command', { keywords: topic.keywords, days: 7 });

        const existingPapers = await getSentinelPapers(topic.id, undefined, undefined, 10000);
        const existingTitles = new Set(existingPapers.map((p) => p.title.toLowerCase().trim()));

        let createdCount = 0;
        for (const paper of arxivPapers.slice(0, 5)) {
          const titleKey = paper.title.toLowerCase().trim();
          if (existingTitles.has(titleKey)) continue;
          await createSentinelPaper({
            topicId: topic.id!,
            title: paper.title,
            authors: paper.authors.join(', '),
            abstract: paper.summary,
            url: paper.id,
            pdfUrl: paper.pdf_url,
            doi: paper.doi || undefined,
            publishedDate: paper.published,
            source: 'arxiv',
            isRead: false,
            isIgnored: false
          });
          existingTitles.add(titleKey);
          createdCount++;
        }

        if (createdCount > 0) {
          await updateSentinelTopic({ ...topic, lastCheckAt: Date.now() });
          await createSentinelCheck({
            timestamp: Date.now(),
            topicsChecked: 1,
            papersFound: createdCount,
            durationMs: Date.now() - checkStartTime,
            metadata: { source: 'auto', topicId: topic.id, keywords: topic.keywords, checkedSources: ['arxiv'] }
          });
          // Update unread count display
          sentinelUnreadCount.value = await countUnreadSentinelPapers(projectStore.currentProjectId);
        }
      }
    } catch (e) {
      console.warn('[Sentinel] Auto-check failed:', e);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours
});

onUnmounted(() => {
  if (zoteroSyncInterval.value) {
    clearInterval(zoteroSyncInterval.value);
    zoteroSyncInterval.value = null;
  }
  if (sentinelCheckInterval.value) {
    clearInterval(sentinelCheckInterval.value);
    sentinelCheckInterval.value = null;
  }
});

const stopStreaming = () => {
  aiClient.cancel();
};

const sendMessage = async () => {
  if (!inputText.value.trim() || isStreaming.value) {
    return;
  }

  if (!settingsStore.isTextConfigured()) {
    showSettings.value = true;
    return;
  }

  // Create new conversation if none exists
  if (!historyStore.currentConversationId) {
    historyStore.createConversation();
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: inputText.value
  };

  messages.value.push(userMessage);
  inputText.value = '';
  isStreaming.value = true;
  streamingText.value = '';

  await messageListRef.value?.scrollToBottom();

  const chatStartTime = performance.now();
  const modelUsed = settingsStore.config.textConfig.model;

  recordEvent({
    event_type: 'chat_start',
    resource_id: historyStore.currentConversationId || undefined,
    metadata: { model: modelUsed }
  });

  // ── Build system prompt with context injections ──
  let systemContent = '';

  // 1. Todo extraction instruction (Phase 1.1)
  systemContent += `If the user expresses an intention to do something later (e.g., "I will try...", "I need to...", "I should...", "let me check..."), append a todo suggestion block at the very end of your response using this exact format:

[TODOS]
- <concise todo description>
[/TODOS]

Only include this block when there is a clear future action. Keep each todo under 15 words. Do NOT include the block if there is no actionable item.\n\n`;

  // 2. Conversation History Summaries (Phase 1.1)
  try {
    const summaries = await loadRecentConversationSummaries(
      projectStore.currentProjectId,
      5
    );
    // Exclude current conversation from summaries
    const otherSummaries = summaries.filter(s => s.id !== historyStore.currentConversationId);
    if (otherSummaries.length > 0) {
      const summaryText = otherSummaries
        .map((s, i) => `${i + 1}. ${s.summary}`)
        .join('\n');
      systemContent += `Previous discussions in this project:\n${summaryText}\n\n`;
    }
  } catch (e) {
    console.warn('[Summary] Failed to load conversation summaries:', e);
  }

  // 3. Knowledge Base Retrieval (Phase 1.3)
  const currentProject = projectStore.currentProject();
  if (
    settingsStore.config.kbAutoRetrieve !== false &&
    currentProject &&
    kbStore.indexedDocs.length > 0
  ) {
    try {
      const topK = settingsStore.config.kbTopK || 5;
      const results = await kbStore.search(userMessage.content as string, topK);
      if (results.length > 0) {
        const context = kbStore.buildContextFromResults(results);
        systemContent += `Use the following knowledge base passages to help answer the user's question. If the passages don't contain relevant information, answer based on your general knowledge.\n\n${context}`;
        // Store citations for display with the upcoming assistant message
        kbCitations.value.set(messages.value.length, results);
      }
    } catch (e) {
      console.warn('[KB] Retrieval failed, continuing without context:', e);
    }
  }

  // 4. Pending todos reminder (Phase 1.1)
  if (currentProject) {
    const pendingTodos = projectStore.todos.filter((t) => t.status === 'pending');
    if (pendingTodos.length > 0) {
      const todoText = pendingTodos
        .slice(0, 3)
        .map((t, i) => `${i + 1}. ${t.content}`)
        .join('\n');
      systemContent += `Pending todos in this project (${pendingTodos.length} total, showing top 3):\n${todoText}\n\n`;
    }
  }

  // 5. New literature reminder (Phase 4.1)
  if (currentProject) {
    try {
      const unreadCount = await countUnreadSentinelPapers(projectStore.currentProjectId);
      if (unreadCount > 0) {
        systemContent += `Note: ${unreadCount} new paper(s) arrived this week from the literature sentinel. You can check them in the sentinel panel.\n\n`;
      }
    } catch (e) {
      // Silently ignore sentinel count failures
    }
  }

  let apiMessages = [...messages.value];
  if (systemContent) {
    const systemMsg: ChatMessage = {
      role: 'system',
      content: systemContent.trim()
    };
    // Insert system context before the user message (which is the last one)
    apiMessages = [
      ...messages.value.slice(0, -1),
      systemMsg,
      messages.value[messages.value.length - 1]
    ];
  }

  try {
    await aiClient.chatStream(apiMessages, {
      onStart: () => {
        streamingText.value = '';
      },
      onToken: (token) => {
        streamingText.value += token;
        messageListRef.value?.scrollToBottom();
      },
      onComplete: (fullText, metadata) => {
        const msgIndex = messages.value.length;
        // Guard against empty responses so the UI doesn't show blank assistant messages
        const content = fullText?.trim() || '[No response received]';
        messages.value.push({
          role: 'assistant',
          content
        });
        if (metadata) {
          messageMetadata.value.set(msgIndex, metadata);
        }
        streamingText.value = '';
        isStreaming.value = false;
        messageListRef.value?.scrollToBottom();

        recordEvent({
          event_type: 'chat_complete',
          resource_id: historyStore.currentConversationId || undefined,
          duration_ms: Math.round(performance.now() - chatStartTime),
          metadata: {
            model: metadata?.modelName || modelUsed,
            success: true,
            is_fallback: metadata?.isFallback,
            latency_ms: metadata?.latencyMs,
            cost: metadata?.estimatedCost
          }
        });

        // ── Generate conversation summary in background (Phase 2) ──
        // Trigger based on user-configured interval (0 = disabled)
        const userMsgCount = messages.value.filter(m => m.role === 'user').length;
        if (shouldGenerateSummary(userMsgCount, settingsStore.config.summaryInterval)) {
          const convId = historyStore.currentConversationId;
          if (convId) {
            generateSessionSummary(convId, messages.value).catch(() => {
              // Silent fail — summary is non-critical
            });
          }
        }
      },
      onInterrupted: (partialText, reason) => {
        // Save the partial response as an assistant message so it stays in context
        const content = partialText?.trim()
          || (reason === 'user'
            ? '[Response interrupted — no content received yet]'
            : '[Response timed out — the model took too long to respond. You can retry or switch to a faster model.]');
        messages.value.push({
          role: 'assistant',
          content
        });
        streamingText.value = '';
        isStreaming.value = false;
        messageListRef.value?.scrollToBottom();

        recordEvent({
          event_type: 'chat_interrupted',
          resource_id: historyStore.currentConversationId || undefined,
          duration_ms: Math.round(performance.now() - chatStartTime),
          metadata: {
            model: modelUsed,
            success: false,
            reason,
            partial_length: partialText.length
          }
        });
      },
      onError: (error, metadata) => {
        console.error('AI Error:', error);
        messages.value.push({
          role: 'assistant',
          content: `Error: ${error.message}`
        });
        streamingText.value = '';
        isStreaming.value = false;
        messageListRef.value?.scrollToBottom();

        recordEvent({
          event_type: 'chat_complete',
          resource_id: historyStore.currentConversationId || undefined,
          duration_ms: Math.round(performance.now() - chatStartTime),
          metadata: {
            model: metadata?.modelName || modelUsed,
            success: false,
            error: error.message,
            is_fallback: metadata?.isFallback
          }
        });
      }
    }, false, 'chat');
  } catch (error: any) {
    console.error('Failed to send message:', error);
    messages.value.push({
      role: 'assistant',
      content: `Failed to send: ${error.message || 'Unknown error'}`
    });
    isStreaming.value = false;
    streamingText.value = '';
    messageListRef.value?.scrollToBottom();

    recordEvent({
      event_type: 'chat_complete',
      resource_id: historyStore.currentConversationId || undefined,
      duration_ms: Math.round(performance.now() - chatStartTime),
      metadata: { model: modelUsed, success: false, error: error?.message || 'Unknown error' }
    });
  }
};

const closeWindow = async () => {
  await appWindow.hide();
};

const finishWelcome = async () => {
  await settingsStore.completeWelcome();
  showWelcome.value = false;
  showSettings.value = false;
  await setWidgetDefaultPosition();
  await show('widget');
  await appWindow.hide();
};

const skipWelcomeAndCreateProject = async () => {
  await settingsStore.completeWelcome();
  showWelcome.value = false;
  showCreateProject.value = true;
};

const newChat = () => {
  messages.value = [];
  historyStore.createConversation();
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleHistory = () => {
  showHistory.value = !showHistory.value;
  showLiterature.value = false;
  showTodos.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleKnowledge = () => {
  showLiterature.value = !showLiterature.value;
  showHistory.value = false;
  showTodos.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleTodos = () => {
  showTodos.value = !showTodos.value;
  showHistory.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleWritingHistory = () => {
  showWritingHistory.value = !showWritingHistory.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleSentinel = () => {
  showSentinel.value = !showSentinel.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleExperiment = () => {
  showExperiment.value = !showExperiment.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const toggleDashboard = () => {
  showDashboard.value = !showDashboard.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showPlugin.value = false;
  showTeam.value = false;
};

const togglePlugin = () => {
  showPlugin.value = !showPlugin.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showTeam.value = false;
};

const toggleTeam = () => {
  showTeam.value = !showTeam.value;
  showHistory.value = false;
  showTodos.value = false;
  showLiterature.value = false;
  showWritingHistory.value = false;
  showSentinel.value = false;
  showExperiment.value = false;
  showDashboard.value = false;
  showPlugin.value = false;
};

const loadFromHistory = (id: string) => {
  const conv = historyStore.loadConversation(id);
  if (conv) {
    messages.value = [...conv.messages];
    showHistory.value = false;
    showDashboard.value = false;
    showTodos.value = false;
    showLiterature.value = false;
    showWritingHistory.value = false;
    showSentinel.value = false;
    showExperiment.value = false;
  }
};

const deleteFromHistory = async (id: string) => {
  await historyStore.deleteConversation(id);
};

/* ── Project selector handlers ── */

const selectProject = async (projectId: string | null) => {
  await projectStore.switchProject(projectId);
  messages.value = [];
  historyStore.currentConversationId = null;
  showProjectDropdown.value = false;
  await loadProjectStats();
};

const resetProjectModal = () => {
  newProjectName.value = '';
  newProjectColor.value = PROJECT_COLORS[0];
  newProjectKeywords.value = '';
  newProjectFolderPath.value = '';
  newProjectZoteroCollection.value = '';
  newProjectObsidianVault.value = '';
  newProjectCitationStyle.value = 'gb7714';
  availableZoteroCollections.value = [];
  isEditingProject.value = false;
  editProjectId.value = null;
};

const openCreateProject = () => {
  showProjectDropdown.value = false;
  resetProjectModal();
  showCreateProject.value = true;
};

const openEditProject = (project: Project) => {
  showProjectDropdown.value = false;
  isEditingProject.value = true;
  editProjectId.value = project.id;
  newProjectName.value = project.name;
  newProjectColor.value = project.color;
  newProjectKeywords.value = project.keywords?.join(', ') || '';
  newProjectFolderPath.value = project.folderPath || '';
  newProjectZoteroCollection.value = project.zoteroCollection || '';
  newProjectObsidianVault.value = project.obsidianVault || '';
  newProjectCitationStyle.value = project.citationStyle || 'gb7714';
  showCreateProject.value = true;
  void loadZoteroCollectionsForProject();
};

const pickProjectFolder = async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected && !Array.isArray(selected)) {
    newProjectFolderPath.value = selected;
  }
};

const pickProjectObsidianVault = async () => {
  const selected = await open({ directory: true, multiple: false });
  if (selected && !Array.isArray(selected)) {
    newProjectObsidianVault.value = selected;
  }
};

const loadZoteroCollectionsForProject = async () => {
  loadingZoteroCollections.value = true;
  try {
    availableZoteroCollections.value = await loadZoteroCollections();
  } catch (e) {
    console.warn('[ProjectConfig] Failed to load Zotero collections:', e);
    availableZoteroCollections.value = [];
  } finally {
    loadingZoteroCollections.value = false;
  }
};

const confirmCreateOrUpdateProject = async () => {
  const name = newProjectName.value.trim();
  if (!name) return;

  const keywords = newProjectKeywords.value
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (isEditingProject.value && editProjectId.value) {
    const project = projectStore.projects.find((p) => p.id === editProjectId.value);
    if (!project) return;
    project.name = name;
    project.color = newProjectColor.value;
    project.keywords = keywords;
    project.folderPath = newProjectFolderPath.value || undefined;
    project.zoteroCollection = newProjectZoteroCollection.value || undefined;
    project.obsidianVault = newProjectObsidianVault.value || undefined;
    project.citationStyle = newProjectCitationStyle.value || undefined;
    await projectStore.updateProject(project);
  } else {
    const project = await projectStore.createProject(name, newProjectColor.value);
    project.keywords = keywords;
    project.folderPath = newProjectFolderPath.value || undefined;
    project.zoteroCollection = newProjectZoteroCollection.value || undefined;
    project.obsidianVault = newProjectObsidianVault.value || undefined;
    project.citationStyle = newProjectCitationStyle.value || undefined;
    await projectStore.updateProject(project);
    messages.value = [];
    historyStore.currentConversationId = null;
  }

  showCreateProject.value = false;
  resetProjectModal();
  await loadProjectStats();
};

/* ── Obsidian save handlers ── */

const openObsidianModal = (content: string) => {
  obsidianContent.value = content;
  obsidianTemplate.value = 'summary';
  obsidianSaveResult.value = null;
  showObsidianModal.value = true;
};

/** Save the entire current conversation to Obsidian with auto-generated summary. */
const saveConversationToObsidian = async () => {
  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;
  if (!vaultPath) {
    showSettings.value = true;
    return;
  }
  if (messages.value.length === 0) {
    return;
  }

  obsidianSaving.value = true;
  obsidianSaveResult.value = null;

  try {
    const project = projectStore.currentProject();
    const title = project?.name || 'AI Conversation';
    const date = new Date().toISOString().split('T')[0];

    // Build full conversation text
    const conversationText = messages.value
      .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');

    // Generate AI summary, key points, and hypotheses
    let summary = '';
    let keyPoints: string[] = [];
    let hypotheses: string[] = [];

    try {
      const { text: summaryText } = await aiClient.chatOnce([
        {
          role: 'system',
          content: 'Summarize the following research conversation in 2-3 concise sentences. Focus on the key question, main insights, and any decisions made. Respond in the same language as the conversation.'
        },
        { role: 'user', content: conversationText.slice(0, 3000) }
      ], false, 'chat');
      summary = summaryText.trim();
    } catch (e) {
      console.warn('[ObsidianSummary] Summary generation failed:', e);
    }

    try {
      const { text: kpText } = await aiClient.chatOnce([
        {
          role: 'system',
          content: 'Extract 3-5 key points or conclusions from the following conversation. Return each point on a separate line starting with "- ". Only return the bullet points, no extra text. Respond in the same language as the conversation.'
        },
        { role: 'user', content: conversationText.slice(0, 3000) }
      ], false, 'chat');
      keyPoints = kpText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter(Boolean);
    } catch (e) {
      console.warn('[ObsidianSummary] Key points generation failed:', e);
    }

    try {
      const { text: hypText } = await aiClient.chatOnce([
        {
          role: 'system',
          content: 'Extract any hypotheses, assumptions, or claims that need verification from the following conversation. Return each on a separate line starting with "- ". Only return the bullet points, no extra text. If none, return "None". Respond in the same language as the conversation.'
        },
        { role: 'user', content: conversationText.slice(0, 3000) }
      ], false, 'chat');
      hypotheses = hypText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter((l) => l.toLowerCase() !== 'none');
    } catch (e) {
      console.warn('[ObsidianSummary] Hypotheses generation failed:', e);
    }

    const result = await saveNoteToObsidian(
      vaultPath,
      folder,
      {
        title: `${date} ${title}`,
        date,
        tags: ['ai-research', 'auto-generated'],
        source: historyStore.currentConversationId || 'unknown',
        project: project?.name,
        content: conversationText,
        summary,
        keyPoints,
        hypotheses
      },
      'summary'
    );

    if (result.success) {
      obsidianSaveResult.value = `Saved to ${result.fileName}`;
      recordEvent({ event_type: 'note_save_to_obsidian', resource_id: result.filePath });
      await openNoteInObsidian(vaultPath, result.filePath);
    } else {
      obsidianSaveResult.value = result.error || 'Save failed';
    }
  } catch (e: any) {
    obsidianSaveResult.value = e?.message || 'Save failed';
  } finally {
    obsidianSaving.value = false;
  }
};

const saveToObsidian = async () => {
  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;
  if (!vaultPath) {
    obsidianSaveResult.value = 'Please configure Obsidian Vault path in Settings.';
    return;
  }

  obsidianSaving.value = true;
  obsidianSaveResult.value = null;

  try {
    const project = projectStore.currentProject();
    const title = project?.name || 'AI Conversation';
    const date = new Date().toISOString().split('T')[0];

    const result = await saveNoteToObsidian(
      vaultPath,
      folder,
      {
        title: `${date} ${title}`,
        date,
        tags: ['ai-research', 'auto-generated'],
        source: historyStore.currentConversationId || 'unknown',
        project: project?.name,
        content: obsidianContent.value
      },
      obsidianTemplate.value
    );

    if (result.success) {
      obsidianSaveResult.value = `Saved to ${result.fileName}`;
      recordEvent({ event_type: 'note_save_to_obsidian', resource_id: result.filePath });
      // Try to open in Obsidian
      await openNoteInObsidian(vaultPath, result.filePath);
    } else {
      obsidianSaveResult.value = result.error || 'Save failed';
    }
  } catch (e: any) {
    obsidianSaveResult.value = e?.message || 'Save failed';
  } finally {
    obsidianSaving.value = false;
  }
};
</script>

<template>
  <div class="main-window">
    <WelcomePanel v-if="showWelcome" @continue="finishWelcome" @create-project="skipWelcomeAndCreateProject" />
    <SettingsPanel v-else-if="showSettings" @close="showSettings = false" />
    <KnowledgePanel v-else-if="showKnowledge" @close="showKnowledge = false" />

    <div v-else class="chat-view">
      <!-- Project selector bar -->
      <div class="project-bar">
        <div class="project-selector" @click="showProjectDropdown = !showProjectDropdown">
          <span
            class="project-dot"
            :style="{ background: projectStore.currentProject()?.color || 'var(--text-muted)' }"
          />
          <span class="project-name">
            {{ projectStore.currentProject()?.name || 'General Chat' }}
          </span>
          <span class="project-arrow">{{ showProjectDropdown ? '▲' : '▼' }}</span>
        </div>
        <!-- Project stats bar -->
        <div v-if="projectStore.currentProjectId" class="project-stats-bar">
          <span class="stat-item">📄 {{ projectStats.docCount }} docs</span>
          <span class="stat-sep">·</span>
          <span class="stat-item">💬 {{ projectStats.conversationCount }} chats</span>
          <span class="stat-sep">·</span>
          <span class="stat-item">📌 {{ projectStats.todoCount }} todos</span>
          <span v-if="sentinelUnreadCount > 0" class="stat-sep">·</span>
          <span
            v-if="sentinelUnreadCount > 0"
            class="stat-item sentinel-badge"
            @click="showSentinel = true"
          >
            📡 {{ sentinelUnreadCount }} new papers
          </span>
        </div>

        <!-- Project dropdown -->
        <div v-if="showProjectDropdown" class="project-dropdown">
          <div
            class="project-option"
            :class="{ active: !projectStore.currentProjectId }"
            @click="selectProject(null)"
          >
            <span class="project-dot" style="background: var(--text-muted)" />
            <span>General Chat</span>
          </div>
          <div
            v-for="project in projectStore.projects"
            :key="project.id"
            class="project-option"
            :class="{ active: projectStore.currentProjectId === project.id }"
          >
            <div class="project-option-main" @click="selectProject(project.id)">
              <span class="project-dot" :style="{ background: project.color }" />
              <span>{{ project.name }}</span>
            </div>
            <button
              class="project-edit-btn"
              title="Edit project"
              @click.stop="openEditProject(project)"
            >
              ✎
            </button>
          </div>
          <div class="project-divider" />
          <div class="project-option create" @click="openCreateProject">
            <span>+ New Project</span>
          </div>
        </div>
      </div>

      <ChatHeader
        @new-chat="newChat"
        @toggle-history="toggleHistory"
        @toggle-knowledge="toggleKnowledge"
        @toggle-todos="toggleTodos"
        @toggle-writing-history="toggleWritingHistory"
        @toggle-sentinel="toggleSentinel"
        @toggle-experiment="toggleExperiment"
        @toggle-dashboard="toggleDashboard"
        @toggle-plugin="togglePlugin"
        @toggle-team="toggleTeam"
        @open-settings="showSettings = true"
        @save-to-obsidian="saveConversationToObsidian"
        @close="closeWindow"
      />

      <HistoryPanel
        v-if="showHistory"
        :conversations="historyStore.projectConversations"
        @load="loadFromHistory"
        @delete="deleteFromHistory"
        @close="showHistory = false"
      />

      <TodoPanel
        v-if="showTodos"
        :todos="projectStore.todos"
        @toggle="projectStore.toggleTodo"
        @delete="projectStore.deleteTodo"
        @add="projectStore.addTodo"
        @close="showTodos = false"
      />

      <LiteratureSidebar
        v-if="showLiterature"
        @open-knowledge-panel="showKnowledge = true"
      />

      <WritingHistoryPanel
        v-if="showWritingHistory"
        @close="showWritingHistory = false"
      />

      <SentinelPanel
        v-if="showSentinel"
        @close="showSentinel = false"
      />

      <ExperimentPanel
        v-if="showExperiment"
        @close="showExperiment = false"
      />

      <DashboardPanel
        v-if="showDashboard"
        @close="showDashboard = false"
      />

      <PluginPanel
        v-if="showPlugin"
        @close="showPlugin = false"
      />

      <TeamPanel
        v-if="showTeam"
        @close="showTeam = false"
      />

      <ChatMessageList
        ref="messageListRef"
        :messages="messages"
        :is-streaming="isStreaming"
        :streaming-text="streamingText"
        :metadata="messageMetadata"
        :kb-citations="kbCitations"
        @save-to-obsidian="openObsidianModal"
        @add-todo="projectStore.addTodo"
      />

      <ChatInputArea
        v-model="inputText"
        :is-streaming="isStreaming"
        @send="sendMessage"
        @stop="stopStreaming"
      />

      <!-- Usage stats bar -->
      <div class="usage-bar" @click="showUsage = !showUsage">
        <span class="usage-label">📊 Usage</span>
        <span v-if="usageStore.hasData" class="usage-mini">
          {{ usageStore.todayStats?.totalCalls || 0 }} calls
        </span>
        <span v-else class="usage-mini">No data yet</span>
        <span class="usage-toggle">{{ showUsage ? '▲' : '▼' }}</span>
      </div>

      <!-- Usage panel -->
      <div v-if="showUsage" class="usage-panel">
        <div class="usage-header">
          <span>Model Usage Stats</span>
          <button class="usage-close" @click.stop="showUsage = false">x</button>
        </div>
        <div v-if="usageStore.loading" class="usage-loading">Loading...</div>
        <div v-else-if="!usageStore.hasData" class="usage-empty">
          No usage data yet. Start chatting to see stats.
        </div>
        <div v-else class="usage-content">
          <div class="usage-summary">
            <div class="usage-metric">
              <div class="metric-value">{{ usageStore.todayStats?.totalCalls || 0 }}</div>
              <div class="metric-label">Calls</div>
            </div>
            <div class="usage-metric">
              <div class="metric-value">{{ usageStore.todayStats?.totalTokens || 0 }}</div>
              <div class="metric-label">Tokens</div>
            </div>
            <div class="usage-metric">
              <div class="metric-value">{{ usageStore.todayStats?.avgLatencyMs || 0 }}ms</div>
              <div class="metric-label">Avg Latency</div>
            </div>
          </div>
          <div v-if="usageStore.todayStats?.modelBreakdown.length" class="usage-breakdown">
            <div class="breakdown-title">By Model</div>
            <div
              v-for="item in usageStore.todayStats?.modelBreakdown"
              :key="item.modelName"
              class="breakdown-row"
            >
              <span>{{ item.modelName }}</span>
              <span>{{ item.calls }} calls</span>
            </div>
          </div>
          <div v-if="usageStore.todayStats?.taskBreakdown.length" class="usage-breakdown">
            <div class="breakdown-title">By Task</div>
            <div
              v-for="item in usageStore.todayStats?.taskBreakdown"
              :key="item.taskType"
              class="breakdown-row"
            >
              <span>{{ item.taskType }}</span>
              <span>{{ item.calls }} calls</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create / Edit project modal -->
    <div v-if="showCreateProject" class="modal-overlay" @click="showCreateProject = false">
      <div class="modal-content project-modal" @click.stop>
        <h3>{{ isEditingProject ? 'Edit Project' : 'Create New Project' }}</h3>

        <div class="form-group">
          <label class="label">Project Name</label>
          <input
            v-model="newProjectName"
            type="text"
            class="input"
            placeholder="Project name..."
            @keydown.enter="confirmCreateOrUpdateProject"
          />
        </div>

        <div class="form-group">
          <label class="label">Color</label>
          <div class="color-picker">
            <button
              v-for="color in PROJECT_COLORS"
              :key="color"
              class="color-swatch"
              :class="{ active: newProjectColor === color }"
              :style="{ background: color }"
              @click="newProjectColor = color"
            />
          </div>
        </div>

        <div class="form-group">
          <label class="label">Keywords (comma-separated)</label>
          <input
            v-model="newProjectKeywords"
            type="text"
            class="input"
            placeholder="e.g. multimodal, hallucination detection, LLM"
          />
        </div>

        <div class="form-group">
          <label class="label">Associated Literature Folder</label>
          <div class="path-input-row">
            <input
              v-model="newProjectFolderPath"
              type="text"
              class="input"
              readonly
              placeholder="Select a folder to auto-index..."
            />
            <button class="btn-secondary" @click="pickProjectFolder">Browse</button>
            <button
              v-if="newProjectFolderPath"
              class="btn-secondary"
              @click="newProjectFolderPath = ''"
            >
              Clear
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">Default Zotero Collection</label>
          <select v-model="newProjectZoteroCollection" class="input select-input">
            <option value="">All collections</option>
            <option
              v-for="coll in availableZoteroCollections"
              :key="coll.key"
              :value="coll.key"
            >
              {{ coll.name }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="label">Obsidian Vault Path</label>
          <div class="path-input-row">
            <input
              v-model="newProjectObsidianVault"
              type="text"
              class="input"
              readonly
              placeholder="Select Obsidian Vault folder..."
            />
            <button class="btn-secondary" @click="pickProjectObsidianVault">Browse</button>
            <button
              v-if="newProjectObsidianVault"
              class="btn-secondary"
              @click="newProjectObsidianVault = ''"
            >
              Clear
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">Default Citation Style</label>
          <select v-model="newProjectCitationStyle" class="input select-input">
            <option value="gb7714">GB/T 7714 (Chinese)</option>
            <option value="apa">APA 7th</option>
            <option value="ieee">IEEE</option>
          </select>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" @click="showCreateProject = false">Cancel</button>
          <button class="btn-primary" @click="confirmCreateOrUpdateProject">
            {{ isEditingProject ? 'Save Changes' : 'Create' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Save to Obsidian modal -->
    <div v-if="showObsidianModal" class="modal-overlay" @click="showObsidianModal = false">
      <div class="modal-content" @click.stop>
        <h3>Save to Obsidian</h3>
        <div class="form-group">
          <label class="label">Template</label>
          <select v-model="obsidianTemplate" class="input select-input">
            <option value="summary">Summary</option>
            <option value="full">Full Record</option>
            <option value="qa">Q&A</option>
          </select>
        </div>
        <div v-if="obsidianSaveResult" class="obsidian-result">
          {{ obsidianSaveResult }}
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showObsidianModal = false">Cancel</button>
          <button
            class="btn-primary"
            :disabled="obsidianSaving"
            @click="saveToObsidian"
          >
            {{ obsidianSaving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border-subtle);
  position: relative;
  overflow: hidden;
  color: var(--text-primary);
}

.chat-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

/* Project bar */
.project-bar {
  position: relative;
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.project-selector {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  transition: background var(--transition-base);
  width: fit-content;
}

.project-selector:hover {
  background: var(--bg-card-hover);
}

.project-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.project-name {
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 600;
}

.project-arrow {
  color: var(--text-dim);
  font-size: 0.65rem;
  margin-left: var(--space-xs);
}

/* Project stats bar */
.project-stats-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: var(--space-xs);
  padding-left: var(--space-sm);
  font-size: 0.7rem;
  color: var(--text-muted);
}

.stat-item {
  font-family: var(--font-mono);
}

.stat-sep {
  color: var(--border-light);
}

.sentinel-badge {
  color: var(--error);
  cursor: pointer;
  transition: color var(--transition-fast);
}

.sentinel-badge:hover {
  color: var(--error);
}

/* Dropdown */
.project-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 1rem;
  min-width: 220px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-sm);
  box-shadow: var(--shadow-xl);
  z-index: 100;
}

.project-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.82rem;
  transition: all var(--transition-fast);
}

.project-option:hover {
  background: var(--bg-card-hover);
}

.project-option.active {
  background: var(--accent-subtle);
  color: var(--accent-text);
}

.project-option.create {
  color: var(--accent-text);
  font-weight: 600;
}

.project-option-main {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
}

.project-edit-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  border-radius: var(--space-xs);
  opacity: 0;
  transition: all var(--transition-fast);
}

.project-option:hover .project-edit-btn {
  opacity: 1;
}

.project-edit-btn:hover {
  color: var(--accent);
  background: var(--accent-subtle);
}

.project-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 0.35rem 0;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-content {
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-2xl);
  width: 340px;
  box-shadow: var(--shadow-xl);
}

.modal-content h3 {
  margin: 0 0 1rem;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 700;
}

.modal-content .input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 0.7rem 0.9rem;
  color: var(--text-primary);
  font-size: 0.88rem;
  outline: none;
  margin-bottom: 1rem;
  font-family: var(--font-body);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.modal-content .input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.modal-content .select-input {
  appearance: auto;
  cursor: pointer;
}

.modal-content .select-input option {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.project-modal {
  max-height: 85vh;
  overflow-y: auto;
  width: 380px;
}

.project-modal .form-group {
  margin-bottom: 0.875rem;
}

.project-modal .label {
  display: block;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.path-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.path-input-row .input {
  flex: 1;
  margin-bottom: 0;
}

.path-input-row .btn-secondary {
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  white-space: nowrap;
}

.color-picker {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.color-swatch.active {
  border-color: var(--text-primary);
  transform: scale(1.15);
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.btn-secondary {
  padding: 0.55rem 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-secondary:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.btn-primary {
  padding: 0.55rem 1rem;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-on-accent);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

/* Usage bar and panel */
.usage-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.4rem 1rem;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-subtle);
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--text-muted);
  transition: background var(--transition-base);
}

.usage-bar:hover {
  background: var(--bg-card-hover);
}

.usage-label {
  font-weight: 600;
}

.usage-mini {
  margin-left: auto;
  font-family: var(--font-mono);
}

.usage-toggle {
  font-size: 0.6rem;
}

.usage-panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-elevated);
  border-top: 1px solid var(--border-light);
  padding: var(--space-lg);
  z-index: 50;
  max-height: 300px;
  overflow-y: auto;
  box-shadow: var(--shadow-xl);
}

.usage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-primary);
}

.usage-close {
  background: var(--bg-card);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all var(--transition-fast);
}

.usage-close:hover {
  background: var(--error-bg);
  color: var(--error);
}

.usage-loading,
.usage-empty {
  text-align: center;
  padding: 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.usage-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.usage-metric {
  text-align: center;
  padding: 0.6rem;
  background: var(--bg-surface);
  border-radius: var(--radius-md);
}

.metric-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--accent);
  font-family: var(--font-mono);
}

.metric-label {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 0.2rem;
}

.usage-breakdown {
  margin-top: 0.75rem;
}

.breakdown-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.breakdown-row span:first-child {
  flex: 1;
}

.breakdown-row span:nth-child(2) {
  color: var(--text-muted);
  margin-right: 1rem;
}

.breakdown-row span:last-child {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

/* Obsidian modal */
.obsidian-result {
  padding: 0.6rem;
  border-radius: var(--radius-md);
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-size: 0.82rem;
  margin-bottom: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.label {
  display: block;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 0.45rem;
  font-size: 0.8rem;
}

.select-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 0.6rem 0.8rem;
  color: var(--text-primary);
  font-size: 0.85rem;
  outline: none;
  font-family: var(--font-body);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.select-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.select-input option {
  background: var(--bg-surface);
  color: var(--text-primary);
}
</style>
