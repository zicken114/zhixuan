<script setup lang="ts">
import { ref, computed } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { aiClient } from '../utils/aiClient';
import { recordEvent } from '../composables/useEvents';
import { loadDocChunks, loadKnowledgeDocs } from '../composables/useDatabase';
import type { KnowledgeDoc } from '../composables/useDatabase';

const appWindow = getCurrentWebviewWindow();

const step = ref(1);
const source = ref<'kb' | 'doi'>('kb');
const selectedKbDocs = ref<Set<string>>(new Set());
const doiInput = ref('');
const reviewStyle = ref<'academic' | 'brief' | 'summary'>('academic');
const focusArea = ref('');
const generating = ref(false);
const progress = ref({ current: 0, total: 0, stage: '' });
const generatedSections = ref<{ title: string; content: string }[]>([]);

const kbItems = ref<KnowledgeDoc[]>([]);
const kbLoading = ref(false);
const kbError = ref<string | null>(null);

const canProceed = computed(() => {
  if (step.value === 1) return true;
  if (step.value === 2) {
    if (source.value === 'doi') return doiInput.value.trim().length > 0;
    return selectedKbDocs.value.size > 0;
  }
  if (step.value === 3) return true;
  return false;
});

const selectedPaperCount = computed(() => {
  if (source.value === 'kb') return selectedKbDocs.value.size;
  if (source.value === 'doi') return doiInput.value.split('\n').map((d) => d.trim()).filter(Boolean).length;
  return 0;
});

const loadKbItems = async () => {
  kbLoading.value = true;
  kbError.value = null;
  try {
    // Load all knowledge docs regardless of project, since this window
    // has its own Pinia store instance with an independent currentProjectId.
    kbItems.value = await loadKnowledgeDocs(undefined);
  } catch (e: any) {
    console.error('[ReviewWizard] Failed to load KB documents:', e);
    kbError.value = e?.message || '加载知乎故事素材失败';
    kbItems.value = [];
  } finally {
    kbLoading.value = false;
  }
};

const toggleKbDoc = (docId: string) => {
  const newSet = new Set(selectedKbDocs.value);
  if (newSet.has(docId)) {
    newSet.delete(docId);
  } else {
    newSet.add(docId);
  }
  selectedKbDocs.value = newSet;
};

const nextStep = async () => {
  if (step.value === 1) {
    if (source.value === 'kb') {
      await loadKbItems();
    }
  }
  if (step.value < 4) {
    step.value++;
  }
};

const prevStep = () => {
  if (step.value > 1) step.value--;
};

const generateReview = async () => {
  if (generating.value) return;
  generating.value = true;
  generatedSections.value = [];
  const startTime = Date.now();

  const paperCount = selectedPaperCount.value;

  await recordEvent({
    event_type: 'synthesis_start',
    metadata: {
      source: source.value,
      paper_count: paperCount,
      review_style: reviewStyle.value,
      focus_area: focusArea.value || undefined,
    },
  });

  try {
    // Build paper list from selected source
    let papers: Array<{ title: string; creators: string; abstract: string; source: string }> = [];

    if (source.value === 'kb') {
      // Fetch actual document chunks for each selected KB document
      const selectedDocs = kbItems.value.filter(d => selectedKbDocs.value.has(d.id));
      for (const doc of selectedDocs) {
        try {
          const chunks = await loadDocChunks(doc.id);
          const fullText = chunks.map(c => c.content).join('\n').slice(0, 4000);
          papers.push({
            title: doc.fileName,
            creators: 'N/A',
            abstract: fullText || '（文档内容为空）',
            source: '知乎故事素材库'
          });
        } catch (e) {
          console.warn(`[ReviewWizard] Failed to load chunks for ${doc.fileName}:`, e);
          papers.push({
            title: doc.fileName,
            creators: 'N/A',
            abstract: '（文档加载失败）',
            source: '知乎故事素材库'
          });
        }
      }
    } else if (source.value === 'doi') {
      const dois = doiInput.value.split('\n').map(d => d.trim()).filter(Boolean);
      papers = dois.map(d => ({
        title: `DOI: ${d}`,
        creators: 'N/A',
        abstract: '待补充',
        source: 'DOI'
      }));
    }

    progress.value = { current: 0, total: papers.length, stage: '逐篇分析中...' };

    // Map phase: analyze each paper in parallel with concurrency limit
    const CONCURRENCY = 3;
    const analyses: (string | null)[] = new Array(papers.length).fill(null);

    async function analyzeBatch(batch: typeof papers, offset: number) {
      const batchPromises = batch.map((paper, idx) => {
        const globalIdx = offset + idx;
        const prompt = `分析以下素材，提取：核心观点、引用论据、数据细节、人物或案例、争议点、可借鉴的表达方式。用中文简洁回答（200字以内）。

标题：${paper.title}
作者：${paper.creators}
摘要：${paper.abstract.slice(0, 2000)}`;

        return aiClient.chatOnce([
          { role: 'system', content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你写深度长文。汇总多份素材，提取核心事实，用知乎经典的破题到分层解析再到升华总结的结构来组织内容。语言接地气，别太端着，像真人写知乎回答一样。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。` },
          { role: 'user', content: prompt }
        ], false, 'literature_review').then(({ text }) => {
          analyses[globalIdx] = `【${paper.title}】\n${text}`;
          progress.value.current = analyses.filter(a => a !== null).length;
        }).catch((e) => {
          console.error(`[ReviewWizard] Analysis failed for ${paper.title}:`, e);
          analyses[globalIdx] = `【${paper.title}】\n分析失败`;
          progress.value.current = analyses.filter(a => a !== null).length;
        });
      });
      await Promise.all(batchPromises);
    }

    for (let i = 0; i < papers.length; i += CONCURRENCY) {
      const batch = papers.slice(i, i + CONCURRENCY);
      await analyzeBatch(batch, i);
    }

    // Reduce phase: generate sections
    const combinedAnalyses = analyses.filter(Boolean).join('\n\n---\n\n');
    const styleLabel = reviewStyle.value === 'academic' ? '深度长文' : reviewStyle.value === 'brief' ? '热点速评' : '简明概述';
    const focusText = focusArea.value ? `，重点关注：${focusArea.value}` : '';

    progress.value = { current: 0, total: 5, stage: '生成综述结构...' };

    const sections = [
      { title: '1. 破题：话题背景与切入点', prompt: `基于以下素材，撰写"破题：话题背景与切入点"部分（300字）。点出话题为什么值得聊、读者为什么关心。风格：${styleLabel}${focusText}\n\n${combinedAnalyses}` },
      { title: '2. 分层解析：核心观点对比', prompt: `基于以下素材，撰写"分层解析：核心观点对比"部分（400字）。分类归纳各篇素材的观点，并指出异同。风格：${styleLabel}${focusText}\n\n${combinedAnalyses}` },
      { title: '3. 关键事实速查表', prompt: `基于以下素材，生成一个 Markdown 表格，对比各篇素材的核心观点、关键数据、典型案例与可借鉴的表达方式。风格：${styleLabel}${focusText}\n\n${combinedAnalyses}` },
      { title: '4. 盲点与延伸思考', prompt: `基于以下素材，撰写"盲点与延伸思考"部分（300字）。指出目前讨论的不足以及还可以挖掘的角度。风格：${styleLabel}${focusText}\n\n${combinedAnalyses}` },
      { title: '5. 升华总结', prompt: `基于以下素材，撰写简短的"升华总结"部分（200字）。给出一个让读者愿意点赞收藏的结尾。风格：${styleLabel}${focusText}\n\n${combinedAnalyses}` },
    ];

    const sectionResults: { title: string; content: string }[] = [];
    for (let i = 0; i < sections.length; i++) {
      progress.value.current = i + 1;
      progress.value.stage = `生成第 ${i + 1}/${sections.length} 部分...`;

      try {
        const { text } = await aiClient.chatOnce([
          { role: 'system', content: '你现在是知乎『盐究员』和千万粉大V。请汇总我提供的多份素材文档，使用 Map-Reduce 的逻辑，提取核心事实。最后，请用知乎经典的『破题->分层解析->升华总结』结构,输出一份至少包含 4 个小标题的深度长文草稿。语言风格要专业客观，适当使用知乎热词。' },
          { role: 'user', content: sections[i].prompt }
        ], false, 'literature_review');
        sectionResults.push({ title: sections[i].title, content: text });
      } catch (e) {
        sectionResults.push({ title: sections[i].title, content: '生成失败' });
      }
    }

    generatedSections.value = sectionResults;
    progress.value.stage = '完成';

    const allSectionsSucceeded = sectionResults.every(s => s.content !== '生成失败');
    await recordEvent({
      event_type: 'synthesis_complete',
      duration_ms: Date.now() - startTime,
      metadata: {
        source: source.value,
        paper_count: paperCount,
        review_style: reviewStyle.value,
        sections_generated: sectionResults.length,
        success: allSectionsSucceeded,
      },
    });
  } catch (e) {
    console.error('[Review] Generation failed:', e);
    await recordEvent({
      event_type: 'synthesis_complete',
      duration_ms: Date.now() - startTime,
      metadata: {
        source: source.value,
        paper_count: paperCount,
        review_style: reviewStyle.value,
        sections_generated: 0,
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
    });
  } finally {
    generating.value = false;
  }
};

const closeWindow = () => {
  appWindow.hide();
};

const copyToClipboard = async () => {
  const text = generatedSections.value.map((s) => `${s.title}\n\n${s.content}`).join('\n\n---\n\n');
  try {
    await navigator.clipboard.writeText(text);
    alert('已复制到剪贴板');
  } catch {
    // fallback
  }
};
</script>

<template>
  <div class="review-wizard">
    <div class="wizard-header" @mousedown="appWindow.startDragging()">
      <span class="header-title">🔥 知乎深度报告</span>
      <button class="close-btn" @click="closeWindow">×</button>
    </div>

    <!-- Step indicator -->
    <div class="step-indicator">
      <div
        v-for="i in 4"
        :key="i"
        class="step-dot"
        :class="{ active: step >= i, current: step === i }"
      >
        {{ i }}
      </div>
    </div>

    <div class="wizard-content">
      <!-- Step 1: Source selection -->
      <div v-if="step === 1" class="step-content">
        <h3>选择素材来源</h3>
        <div class="source-options">
          <button
            class="source-card"
            :class="{ active: source === 'kb' }"
            @click="source = 'kb'"
          >
            <span class="source-icon">📄</span>
            <span class="source-label">知乎故事素材库</span>
          </button>
          <button
            class="source-card"
            :class="{ active: source === 'doi' }"
            @click="source = 'doi'"
          >
            <span class="source-icon">🔗</span>
            <span class="source-label">粘贴 DOI</span>
          </button>
        </div>
      </div>

      <!-- Step 2: Paper selection -->
      <div v-if="step === 2" class="step-content">
        <h3>选择素材</h3>

        <div v-if="source === 'kb'" class="paper-list">
          <div v-if="kbLoading" class="loading">加载知乎故事素材中...</div>
          <div v-else-if="kbError" class="loading error">{{ kbError }}</div>
          <div v-else-if="kbItems.length === 0" class="loading">暂无故事素材</div>
          <div
            v-for="doc in kbItems"
            :key="doc.id"
            class="paper-select-item"
            :class="{ selected: selectedKbDocs.has(doc.id) }"
            @click="toggleKbDoc(doc.id)"
          >
            <input
              type="checkbox"
              :checked="selectedKbDocs.has(doc.id)"
              @click.stop
              @change="toggleKbDoc(doc.id)"
            />
            <div class="paper-info">
              <div class="paper-title">{{ doc.fileName }}</div>
              <div class="paper-meta">{{ doc.indexStatus }}</div>
            </div>
          </div>
        </div>

        <div v-else-if="source === 'doi'" class="doi-input">
          <textarea
            v-model="doiInput"
            rows="5"
            placeholder="每行输入一个 DOI...&#10;例如：&#10;10.1000/xyz123&#10;10.1000/abc456"
          />
        </div>

        <div class="selection-count">
          已选择 {{ selectedPaperCount }} 篇素材
        </div>
      </div>

      <!-- Step 3: Style selection -->
      <div v-if="step === 3" class="step-content">
        <h3>选择综述风格</h3>

        <div class="style-options">
          <button
            class="style-card"
            :class="{ active: reviewStyle === 'academic' }"
            @click="reviewStyle = 'academic'"
          >
            <div class="style-name">深度长文</div>
            <div class="style-desc">结构严谨，适合写知乎长文回答</div>
          </button>
          <button
            class="style-card"
            :class="{ active: reviewStyle === 'brief' }"
            @click="reviewStyle = 'brief'"
          >
            <div class="style-name">调研简报</div>
            <div class="style-desc">简洁明了，适合团队汇报</div>
          </button>
          <button
            class="style-card"
            :class="{ active: reviewStyle === 'summary' }"
            @click="reviewStyle = 'summary'"
          >
            <div class="style-name">简要概述</div>
            <div class="style-desc">快速了解领域概况</div>
          </button>
        </div>

        <div class="form-group">
          <label>聚焦方向（可选）</label>
          <input
            v-model="focusArea"
            type="text"
            placeholder="例如：多模态融合策略"
          />
        </div>
      </div>

      <!-- Step 4: Generation -->
      <div v-if="step === 4" class="step-content">
        <div v-if="!generating && generatedSections.length === 0" class="confirm-step">
          <h3>确认生成</h3>
          <div class="confirm-info">
            <div class="info-row">
              <span class="info-label">素材数量：</span>
              <span>{{ selectedPaperCount }} 篇</span>
            </div>
            <div class="info-row">
              <span class="info-label">报告风格：</span>
              <span>{{ reviewStyle === 'academic' ? '深度长文' : reviewStyle === 'brief' ? '热点速评' : '简明概述' }}</span>
            </div>
            <div v-if="focusArea" class="info-row">
              <span class="info-label">聚焦方向：</span>
              <span>{{ focusArea }}</span>
            </div>
          </div>
          <button class="generate-btn" @click="generateReview" :disabled="generating">开始生成</button>
        </div>

        <div v-else-if="generating" class="generating">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{ width: `${(progress.current / progress.total) * 100}%` }"
            />
          </div>
          <div class="progress-stage">{{ progress.stage }}</div>
          <div class="progress-detail">{{ progress.current }} / {{ progress.total }}</div>
        </div>

        <div v-else class="result-preview">
          <div class="result-header">
            <h3>生成结果</h3>
            <button class="copy-btn" @click="copyToClipboard">复制全文</button>
          </div>
          <div class="sections">
            <div v-for="section in generatedSections" :key="section.title" class="section">
              <h4>{{ section.title }}</h4>
              <div class="section-content">{{ section.content }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="step < 4 || (!generating && generatedSections.length === 0)" class="wizard-footer">
      <button class="footer-btn" :disabled="step === 1" @click="prevStep">上一步</button>
      <button v-if="step < 4" class="footer-btn primary" :disabled="!canProceed" @click="nextStep">下一步</button>
    </div>
  </div>
</template>

<style scoped>
.review-wizard {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  overflow: hidden;
}

.wizard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.step-indicator {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem;
  border-bottom: 1px solid var(--border-subtle);
}

.step-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  background: var(--bg-surface);
  color: var(--text-muted);
  border: 1px solid var(--border-light);
}

.step-dot.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.step-dot.current {
  box-shadow: 0 0 8px rgba(26, 115, 232, 0.2);
}

.wizard-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
}

.step-content h3 {
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.source-options,
.style-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.source-card,
.style-card {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s ease;
  text-align: left;
}

.source-card:hover,
.style-card:hover {
  background: var(--bg-card-hover);
}

.source-card.active,
.style-card.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
}

.source-icon {
  font-size: 1.25rem;
}

.source-label {
  font-size: 0.85rem;
  font-weight: 600;
}

.style-name {
  font-size: 0.85rem;
  font-weight: 600;
}

.style-desc {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.paper-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 300px;
  overflow-y: auto;
}

.paper-select-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.paper-select-item:hover {
  background: var(--bg-card-hover);
}

.paper-select-item.selected {
  border-color: var(--accent-border);
}

.paper-select-item input[type="checkbox"] {
  accent-color: var(--accent);
}

.paper-info {
  flex: 1;
  min-width: 0;
}

.paper-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paper-meta {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.selection-count {
  margin-top: 0.5rem;
  font-size: 0.78rem;
  color: var(--accent);
  text-align: center;
}

.doi-input textarea {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.6rem;
  color: var(--text-primary);
  font-size: 0.82rem;
  resize: none;
  font-family: 'JetBrains Mono', monospace;
}

.form-group {
  margin-top: 0.75rem;
}

.form-group label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.form-group input {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  color: var(--text-primary);
  font-size: 0.82rem;
  outline: none;
}

.confirm-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
}

.confirm-info {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 1rem;
  width: 100%;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.3rem 0;
  font-size: 0.82rem;
}

.info-label {
  color: var(--text-secondary);
}

.generate-btn {
  padding: 0.6rem 2rem;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  color: var(--text-on-accent);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.generating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem 0;
}

.progress-bar {
  width: 80%;
  height: 4px;
  background: var(--bg-surface);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-stage {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.progress-detail {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.result-preview {
  padding: 0.5rem 0;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.result-header h3 {
  margin: 0;
}

.copy-btn {
  padding: 0.35rem 0.7rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section h4 {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  color: var(--accent);
}

.section-content {
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.wizard-footer {
  display: flex;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border-subtle);
}

.footer-btn {
  padding: 0.4rem 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
}

.footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.footer-btn.primary {
  background: var(--accent);
  border: none;
  color: var(--text-on-accent);
  font-weight: 700;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
}

.loading.error {
  color: var(--error);
}
</style>
