<script setup lang="ts">
import { useI18n } from '../composables/useI18n';

const { t } = useI18n();

const emit = defineEmits<{
  continue: [];
  'create-project': [];
}>();
</script>

<template>
  <div class="welcome-panel">
    <button class="close-btn" @click="emit('continue')">x</button>

    <div class="hero">
      <div class="eyebrow">{{ t('welcome.eyebrow') }}</div>
      <h2>「知玄」- 知乎全场景悬浮创作舱</h2>
      <p class="intro">{{ t('welcome.intro') }}</p>
    </div>

    <div class="grid">
      <div class="card">
        <h3>{{ t('welcome.startTitle') }}</h3>
        <p>{{ t('welcome.start1') }}</p>
        <p>{{ t('welcome.start2') }}</p>
        <p>{{ t('welcome.start3') }}</p>
      </div>

      <div class="card">
        <h3>{{ t('welcome.actionsTitle') }}</h3>
        <p>{{ t('welcome.actions1') }}</p>
        <p>{{ t('welcome.actions2') }}</p>
        <p>{{ t('welcome.actions3') }}</p>
      </div>

      <div class="card">
        <h3>{{ t('welcome.designTitle') }}</h3>
        <p>{{ t('welcome.designBody') }}</p>
      </div>
    </div>

    <div class="footer">
      <button class="primary-btn" @click="emit('continue')">{{ t('welcome.primary') }}</button>
      <p class="footer-note">{{ t('welcome.footer') }}</p>
    </div>
  </div>
</template>

<style scoped>
.welcome-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  box-sizing: border-box;
  position: relative;
  background: var(--bg-base);
  color: var(--text-primary);
  overflow-y: auto;
}

.close-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: var(--bg-card-hover);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

.hero {
  margin-bottom: 1rem;
}

.eyebrow {
  display: inline-flex;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: var(--accent-subtle);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.9rem;
}

.hero h2 {
  margin: 0 0 0.7rem 0;
  font-size: 1.5rem;
  line-height: 1.2;
  font-family: 'Syne', sans-serif;
}

.intro {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.7;
  max-width: 34rem;
}

.grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 18px;
  padding: 1.05rem;
  box-shadow: var(--shadow-lg);
}

.card h3 {
  margin: 0 0 0.75rem 0;
  font-size: 0.88rem;
  color: var(--text-primary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.card p {
  margin: 0 0 0.6rem 0;
  color: var(--text-secondary);
  line-height: 1.65;
  font-size: 0.9rem;
}

.card p:last-child {
  margin-bottom: 0;
}

.footer {
  margin-top: auto;
  padding-top: 1.4rem;
}

.primary-btn {
  width: 100%;
  border: none;
  border-radius: 14px;
  padding: 0.95rem 1.1rem;
  background: var(--accent);
  color: var(--text-on-accent);
  font-size: 0.95rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 12px 24px rgba(26, 115, 232, 0.25);
}

.primary-btn:hover {
  transform: translateY(-1px);
}

.secondary-btn {
  width: 100%;
  margin-top: 0.7rem;
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 0.85rem 1.1rem;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
}

.footer-note {
  margin: 0.8rem 0 0;
  color: var(--text-muted);
  text-align: center;
  font-size: 0.8rem;
}
</style>
