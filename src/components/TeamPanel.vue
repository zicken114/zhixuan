<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const emit = defineEmits<{
  close: [];
}>();

interface Team {
  id: string;
  name: string;
  sync_mode: string;
  owner_id: string;
  created_at: number;
}

interface TeamMember {
  team_id: string;
  user_id: string;
  user_name: string;
  role: string;
  joined_at: number;
  last_seen_at?: number;
}

interface TeamActivity {
  id?: number;
  team_id: string;
  user_id: string;
  user_name: string;
  activity_type: string;
  title: string;
  content?: string;
  created_at: number;
}

const teams = ref<Team[]>([]);
const selectedTeam = ref<Team | null>(null);
const members = ref<TeamMember[]>([]);
const activities = ref<TeamActivity[]>([]);
const showCreateModal = ref(false);
const showJoinModal = ref(false);
const newTeamName = ref('');
const newTeamSyncMode = ref<'p2p' | 'server'>('p2p');
const inviteCode = ref('');
const userName = ref('Me');
const loading = ref(false);

async function loadTeams() {
  try {
    const result = await invoke<Team[]>('list_teams');
    teams.value = result;
    if (result.length > 0 && !selectedTeam.value) {
      selectTeam(result[0]);
    }
  } catch (e) {
    console.error('Failed to load teams:', e);
  }
}

async function selectTeam(team: Team) {
  selectedTeam.value = team;
  loading.value = true;
  try {
    const [m, a] = await Promise.all([
      invoke<TeamMember[]>('list_team_members', { teamId: team.id }),
      invoke<TeamActivity[]>('list_team_activities', { teamId: team.id, limit: 20 }),
    ]);
    members.value = m;
    activities.value = a;
  } catch (e) {
    console.error('Failed to load team details:', e);
  } finally {
    loading.value = false;
  }
}

async function createTeam() {
  if (!newTeamName.value.trim()) return;
  try {
    const team = await invoke<Team>('create_team', {
      name: newTeamName.value,
      syncMode: newTeamSyncMode.value,
      ownerId: 'user_' + Date.now(),
    });
    teams.value.push(team);
    selectedTeam.value = team;
    showCreateModal.value = false;
    newTeamName.value = '';
    await selectTeam(team);
  } catch (e) {
    alert('Failed to create team: ' + e);
  }
}

async function joinTeam() {
  if (!inviteCode.value.trim()) return;
  try {
    const team = await invoke<Team>('join_team_by_invite', {
      inviteCode: inviteCode.value,
      userId: 'user_' + Date.now(),
      userName: userName.value,
    });
    teams.value.push(team);
    selectedTeam.value = team;
    showJoinModal.value = false;
    inviteCode.value = '';
    await selectTeam(team);
  } catch (e) {
    alert('Failed to join team: ' + e);
  }
}

async function deleteTeam(team: Team) {
  if (!confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
  try {
    await invoke('delete_team', { id: team.id });
    teams.value = teams.value.filter(t => t.id !== team.id);
    if (selectedTeam.value?.id === team.id) {
      selectedTeam.value = teams.value[0] || null;
      if (selectedTeam.value) await selectTeam(selectedTeam.value);
    }
  } catch (e) {
    alert('Failed to delete team: ' + e);
  }
}

async function generateInvite() {
  if (!selectedTeam.value) return;
  try {
    const invite = await invoke<{ invite_code: string }>('create_team_invite', {
      teamId: selectedTeam.value.id,
      role: 'member',
      expiresHours: 24,
    });
    alert(`Invite code: ${invite.invite_code}\nShare this code with your team members.`);
  } catch (e) {
    alert('Failed to generate invite: ' + e);
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getActivityIcon(type: string): string {
  const icons: Record<string, string> = {
    pdf_read: '📄',
    annotation: '💬',
    note_share: '📝',
    experiment: '🔬',
    chat_share: '💭',
    todo_complete: '✅',
  };
  return icons[type] || '📌';
}

onMounted(loadTeams);
</script>

<template>
  <div class="team-panel">
    <div class="panel-header">
      <h3>Team Space</h3>
      <button class="close-btn" @click="emit('close')">&times;</button>
    </div>

    <div v-if="!selectedTeam" class="no-team-view">
      <div class="empty-illustration">👥</div>
      <h4>No Teams Yet</h4>
      <p>Create a team for your research group or join an existing one.</p>
      <div class="action-buttons">
        <button class="primary-btn" @click="showCreateModal = true">
          Create Team
        </button>
        <button class="secondary-btn" @click="showJoinModal = true">
          Join Team
        </button>
      </div>
    </div>

    <div v-else class="team-view">
      <div class="team-sidebar">
        <div class="team-list-header">
          <span class="section-label">Teams</span>
          <button class="icon-btn-small" @click="showCreateModal = true" title="New team">+</button>
        </div>
        <div class="team-list">
          <div
            v-for="team in teams"
            :key="team.id"
            class="team-item"
            :class="{ active: selectedTeam?.id === team.id }"
            @click="selectTeam(team)"
          >
            <div class="team-avatar">{{ team.name[0] }}</div>
            <div class="team-info">
              <span class="team-name">{{ team.name }}</span>
              <span class="team-mode">{{ team.sync_mode }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="team-content">
        <div class="team-content-header">
          <h4>{{ selectedTeam.name }}</h4>
          <div class="header-actions">
            <button class="text-btn" @click="generateInvite">Invite</button>
            <button class="text-btn danger" @click="deleteTeam(selectedTeam)">Delete</button>
          </div>
        </div>

        <div class="team-tabs">
          <div class="tab-section">
            <h5>Members ({{ members.length }})</h5>
            <div class="member-list">
              <div v-for="member in members" :key="member.user_id" class="member-item">
                <div class="member-avatar">{{ member.user_name[0] }}</div>
                <div class="member-info">
                  <span class="member-name">{{ member.user_name }}</span>
                  <span class="member-role">{{ member.role }}</span>
                </div>
                <span v-if="member.last_seen_at" class="status online" title="Online">●</span>
                <span v-else class="status offline" title="Offline">○</span>
              </div>
            </div>
          </div>

          <div class="tab-section">
            <h5>Activity Feed</h5>
            <div v-if="loading" class="loading">Loading...</div>
            <div v-else-if="activities.length === 0" class="empty-feed">
              No activity yet. Share papers, notes, or chat sessions with your team!
            </div>
            <div v-else class="activity-list">
              <div v-for="activity in activities" :key="activity.id" class="activity-item">
                <span class="activity-icon">{{ getActivityIcon(activity.activity_type) }}</span>
                <div class="activity-body">
                  <div class="activity-title">{{ activity.title }}</div>
                  <div v-if="activity.content" class="activity-content">{{ activity.content }}</div>
                  <div class="activity-meta">
                    <span>{{ activity.user_name }}</span>
                    <span>·</span>
                    <span>{{ formatTime(activity.created_at) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Team Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal">
        <h4>Create Team</h4>
        <input
          v-model="newTeamName"
          placeholder="Team name (e.g., Zhang Lab 2026)"
          class="modal-input"
          @keyup.enter="createTeam"
        />
        <div class="modal-field">
          <label>Sync Mode</label>
          <select v-model="newTeamSyncMode" class="modal-select">
            <option value="p2p">P2P Direct Connect</option>
            <option value="server">Self-hosted Server</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="secondary-btn" @click="showCreateModal = false">Cancel</button>
          <button class="primary-btn" @click="createTeam">Create</button>
        </div>
      </div>
    </div>

    <!-- Join Team Modal -->
    <div v-if="showJoinModal" class="modal-overlay" @click.self="showJoinModal = false">
      <div class="modal">
        <h4>Join Team</h4>
        <input
          v-model="inviteCode"
          placeholder="Enter invite code"
          class="modal-input"
          @keyup.enter="joinTeam"
        />
        <input
          v-model="userName"
          placeholder="Your name"
          class="modal-input"
        />
        <div class="modal-actions">
          <button class="secondary-btn" @click="showJoinModal = false">Cancel</button>
          <button class="primary-btn" @click="joinTeam">Join</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.team-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 420px;
  height: 100vh;
  background: #0d0d14;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-header h3 {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #f0f0f5;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.5);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.no-team-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  color: rgba(240, 240, 245, 0.5);
}

.empty-illustration {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.no-team-view h4 {
  color: #f0f0f5;
  margin: 0 0 0.5rem 0;
}

.no-team-view p {
  margin: 0 0 1.5rem 0;
  font-size: 0.9rem;
  max-width: 260px;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
}

.primary-btn {
  background: rgba(0, 229, 204, 0.15);
  border: 1px solid rgba(0, 229, 204, 0.3);
  color: #00e5cc;
  padding: 0.6rem 1.25rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.primary-btn:hover {
  background: rgba(0, 229, 204, 0.25);
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.7);
  padding: 0.6rem 1.25rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.team-view {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.team-sidebar {
  width: 140px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
}

.team-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(240, 240, 245, 0.4);
}

.icon-btn-small {
  background: rgba(255, 255, 255, 0.06);
  border: none;
  color: rgba(240, 240, 245, 0.6);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.team-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.team-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.team-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.team-item.active {
  background: rgba(0, 229, 204, 0.1);
}

.team-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #3d74e7, #00e5cc);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.team-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.team-name {
  font-size: 0.85rem;
  color: #f0f0f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.team-mode {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
}

.team-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.team-content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.team-content-header h4 {
  margin: 0;
  font-size: 0.95rem;
  color: #f0f0f5;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.text-btn {
  background: none;
  border: none;
  color: #00e5cc;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.text-btn:hover {
  background: rgba(0, 229, 204, 0.1);
}

.text-btn.danger {
  color: #ef4444;
}

.text-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.team-tabs {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
}

.tab-section {
  margin-bottom: 1.5rem;
}

.tab-section h5 {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(240, 240, 245, 0.4);
  margin: 0 0 0.75rem 0;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.member-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #3d74e7);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  flex-shrink: 0;
}

.member-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.member-name {
  font-size: 0.85rem;
  color: #f0f0f5;
}

.member-role {
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.4);
  text-transform: capitalize;
}

.status {
  font-size: 0.7rem;
}

.status.online {
  color: #22c55e;
}

.status.offline {
  color: rgba(240, 240, 245, 0.2);
}

.loading {
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.85rem;
  padding: 1rem 0;
}

.empty-feed {
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.85rem;
  padding: 1rem 0;
  text-align: center;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.activity-item {
  display: flex;
  gap: 0.6rem;
  padding: 0.6rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.activity-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.activity-body {
  flex: 1;
  min-width: 0;
}

.activity-title {
  font-size: 0.85rem;
  color: #f0f0f5;
  margin-bottom: 0.2rem;
}

.activity-content {
  font-size: 0.8rem;
  color: rgba(240, 240, 245, 0.5);
  margin-bottom: 0.3rem;
  line-height: 1.4;
}

.activity-meta {
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.3);
  display: flex;
  gap: 0.4rem;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 1.5rem;
  width: 320px;
  max-width: 90vw;
}

.modal h4 {
  margin: 0 0 1rem 0;
  color: #f0f0f5;
  font-size: 1rem;
}

.modal-input,
.modal-select {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f0f0f5;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
  outline: none;
}

.modal-input:focus,
.modal-select:focus {
  border-color: rgba(0, 229, 204, 0.4);
}

.modal-field {
  margin-bottom: 0.75rem;
}

.modal-field label {
  display: block;
  font-size: 0.8rem;
  color: rgba(240, 240, 245, 0.5);
  margin-bottom: 0.3rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
