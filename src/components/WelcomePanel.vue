<script setup lang="ts">
const emit = defineEmits<{
  continue: [];
  'create-project': [];
}>();
</script>

<template>
  <div class="welcome-panel">
    <button class="close-btn" @click="emit('continue')">x</button>

    <div class="hero">
      <div class="eyebrow">Welcome</div>
      <h2>AI Research Assistant</h2>
      <p class="intro">
        A desktop helper for research and writing workflows. It gives you a floating ball,
        quick clipboard actions, a chat sidebar, and screenshot extraction powered by AI.
      </p>
    </div>

    <div class="grid">
      <div class="card">
        <h3>How To Start</h3>
        <p>1. Double-click the floating ball to open the main chat window.</p>
        <p>2. Open Settings and configure your text and vision providers.</p>
        <p>3. Save your API keys, then return to the floating ball workflow.</p>
      </div>

      <div class="card">
        <h3>Quick Actions</h3>
        <p><strong>Single click</strong> the floating ball to open the quick menu.</p>
        <p><strong>Alt + Q</strong> opens translation, cleanup, and citation tools.</p>
        <p><strong>Alt + S</strong> starts screenshot selection and content extraction.</p>
      </div>

      <div class="card">
        <h3>Design Principle</h3>
        <p>The app stays user-driven: no hidden background assistant behavior, no passive clipboard monitoring, and no silent word tracking.</p>
      </div>
    </div>

    <div class="footer">
      <button class="primary-btn" @click="emit('continue')">Start With Floating Ball</button>
      <button class="secondary-btn" @click="emit('create-project')">Create My First Research Project</button>
      <p class="footer-note">You can reopen the main window anytime by double-clicking the floating ball.</p>
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
  background:
    radial-gradient(circle at top right, rgba(0, 229, 204, 0.14), transparent 28%),
    radial-gradient(circle at bottom left, rgba(79, 140, 255, 0.16), transparent 30%),
    linear-gradient(180deg, rgba(10, 12, 18, 0.98) 0%, rgba(7, 7, 13, 0.98) 100%);
  color: #f5f7fb;
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
  background: rgba(255, 255, 255, 0.08);
  color: rgba(245, 247, 251, 0.82);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.16);
  color: #ffffff;
}

.hero {
  margin-bottom: 1.5rem;
}

.eyebrow {
  display: inline-flex;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(0, 229, 204, 0.14);
  color: #7ef5e6;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.9rem;
}

.hero h2 {
  margin: 0 0 0.7rem 0;
  font-size: 1.9rem;
  line-height: 1.15;
  font-family: 'Syne', sans-serif;
}

.intro {
  margin: 0;
  color: rgba(240, 240, 245, 0.72);
  font-size: 0.95rem;
  line-height: 1.7;
  max-width: 34rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
}

.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 1.05rem;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.18);
}

.card h3 {
  margin: 0 0 0.75rem 0;
  font-size: 0.88rem;
  color: #ffffff;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.card p {
  margin: 0 0 0.6rem 0;
  color: rgba(240, 240, 245, 0.72);
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
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #05211d;
  font-size: 0.95rem;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 12px 24px rgba(0, 184, 163, 0.25);
}

.primary-btn:hover {
  transform: translateY(-1px);
}

.secondary-btn {
  width: 100%;
  margin-top: 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 0.85rem 1.1rem;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(240, 240, 245, 0.85);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.footer-note {
  margin: 0.8rem 0 0;
  color: rgba(240, 240, 245, 0.48);
  text-align: center;
  font-size: 0.8rem;
}
</style>
