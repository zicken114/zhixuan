use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/* ───────────────────────────────────────────────
   Data structures
   ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
    pub sync_mode: String, // "p2p" or "server"
    pub encryption_key: Option<String>,
    pub owner_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub team_id: String,
    pub user_id: String,
    pub user_name: String,
    pub role: String, // "owner", "member", "viewer"
    pub joined_at: i64,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamActivity {
    pub id: Option<i64>,
    pub team_id: String,
    pub user_id: String,
    pub user_name: String,
    pub activity_type: String,
    pub title: String,
    pub content: Option<String>,
    pub metadata: Option<String>, // JSON
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamInvite {
    pub id: String,
    pub team_id: String,
    pub invite_code: String,
    pub role: String, // "member" or "viewer"
    pub expires_at: i64,
    pub created_at: i64,
}

/* ───────────────────────────────────────────────
   In-memory stores
   ─────────────────────────────────────────────── */

static TEAMS: Mutex<Vec<Team>> = Mutex::new(Vec::new());
static MEMBERS: Mutex<Vec<TeamMember>> = Mutex::new(Vec::new());
static ACTIVITIES: Mutex<Vec<TeamActivity>> = Mutex::new(Vec::new());
static INVITES: Mutex<Vec<TeamInvite>> = Mutex::new(Vec::new());

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/* ───────────────────────────────────────────────
   Commands
   ─────────────────────────────────────────────── */

#[tauri::command]
pub fn create_team(name: String, sync_mode: String, owner_id: String) -> Result<Team, String> {
    let id = format!("team_{}", now_ms());
    let team = Team {
        id: id.clone(),
        name,
        sync_mode,
        encryption_key: None,
        owner_id: owner_id.clone(),
        created_at: now_ms(),
        updated_at: now_ms(),
    };

    let mut teams = TEAMS.lock().map_err(|e| e.to_string())?;
    teams.push(team.clone());

    // Auto-add owner as member
    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    members.push(TeamMember {
        team_id: id,
        user_id: owner_id,
        user_name: "Owner".to_string(),
        role: "owner".to_string(),
        joined_at: now_ms(),
        last_seen_at: Some(now_ms()),
    });

    Ok(team)
}

#[tauri::command]
pub fn update_team(id: String, name: String, sync_mode: String) -> Result<(), String> {
    let mut teams = TEAMS.lock().map_err(|e| e.to_string())?;
    if let Some(team) = teams.iter_mut().find(|t| t.id == id) {
        team.name = name;
        team.sync_mode = sync_mode;
        team.updated_at = now_ms();
    }
    Ok(())
}

#[tauri::command]
pub fn delete_team(id: String) -> Result<(), String> {
    let mut teams = TEAMS.lock().map_err(|e| e.to_string())?;
    teams.retain(|t| t.id != id);

    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    members.retain(|m| m.team_id != id);

    let mut activities = ACTIVITIES.lock().map_err(|e| e.to_string())?;
    activities.retain(|a| a.team_id != id);

    let mut invites = INVITES.lock().map_err(|e| e.to_string())?;
    invites.retain(|i| i.team_id != id);

    Ok(())
}

#[tauri::command]
pub fn list_teams() -> Result<Vec<Team>, String> {
    let teams = TEAMS.lock().map_err(|e| e.to_string())?;
    Ok(teams.clone())
}

#[tauri::command]
pub fn get_team(id: String) -> Result<Option<Team>, String> {
    let teams = TEAMS.lock().map_err(|e| e.to_string())?;
    Ok(teams.iter().find(|t| t.id == id).cloned())
}

#[tauri::command]
pub fn add_team_member(team_id: String, user_id: String, user_name: String, role: String) -> Result<(), String> {
    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    // Remove existing membership if any
    members.retain(|m| !(m.team_id == team_id && m.user_id == user_id));
    members.push(TeamMember {
        team_id,
        user_id,
        user_name,
        role,
        joined_at: now_ms(),
        last_seen_at: Some(now_ms()),
    });
    Ok(())
}

#[tauri::command]
pub fn remove_team_member(team_id: String, user_id: String) -> Result<(), String> {
    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    members.retain(|m| !(m.team_id == team_id && m.user_id == user_id));
    Ok(())
}

#[tauri::command]
pub fn list_team_members(team_id: String) -> Result<Vec<TeamMember>, String> {
    let members = MEMBERS.lock().map_err(|e| e.to_string())?;
    let results: Vec<TeamMember> = members
        .iter()
        .filter(|m| m.team_id == team_id)
        .cloned()
        .collect();
    Ok(results)
}

#[tauri::command]
pub fn update_member_role(team_id: String, user_id: String, role: String) -> Result<(), String> {
    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    if let Some(member) = members.iter_mut().find(|m| m.team_id == team_id && m.user_id == user_id) {
        member.role = role;
    }
    Ok(())
}

#[tauri::command]
pub fn create_team_activity(
    team_id: String,
    user_id: String,
    user_name: String,
    activity_type: String,
    title: String,
    content: Option<String>,
    metadata: Option<String>,
) -> Result<TeamActivity, String> {
    let activity = TeamActivity {
        id: Some({
            let activities = ACTIVITIES.lock().map_err(|e| e.to_string())?;
            activities.len() as i64 + 1
        }),
        team_id,
        user_id,
        user_name,
        activity_type,
        title,
        content,
        metadata,
        created_at: now_ms(),
    };

    let mut activities = ACTIVITIES.lock().map_err(|e| e.to_string())?;
    activities.push(activity.clone());

    Ok(activity)
}

#[tauri::command]
pub fn list_team_activities(team_id: String, limit: Option<u32>) -> Result<Vec<TeamActivity>, String> {
    let activities = ACTIVITIES.lock().map_err(|e| e.to_string())?;
    let mut results: Vec<TeamActivity> = activities
        .iter()
        .filter(|a| a.team_id == team_id)
        .cloned()
        .collect();
    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let limit = limit.unwrap_or(50) as usize;
    Ok(results.into_iter().take(limit).collect())
}

#[tauri::command]
pub fn create_team_invite(team_id: String, role: String, expires_hours: Option<u32>) -> Result<TeamInvite, String> {
    let id = format!("invite_{}", now_ms());
    let invite_code = format!("{:06}", now_ms() % 1000000);
    let expires_at = now_ms() + (expires_hours.unwrap_or(24) as i64 * 3600 * 1000);

    let invite = TeamInvite {
        id: id.clone(),
        team_id,
        invite_code: invite_code.clone(),
        role,
        expires_at,
        created_at: now_ms(),
    };

    let mut invites = INVITES.lock().map_err(|e| e.to_string())?;
    invites.push(invite.clone());

    Ok(invite)
}

#[tauri::command]
pub fn get_team_invite_by_code(invite_code: String) -> Result<Option<TeamInvite>, String> {
    let invites = INVITES.lock().map_err(|e| e.to_string())?;
    Ok(invites.iter().find(|i| i.invite_code == invite_code).cloned())
}

#[tauri::command]
pub fn delete_team_invite(id: String) -> Result<(), String> {
    let mut invites = INVITES.lock().map_err(|e| e.to_string())?;
    invites.retain(|i| i.id != id);
    Ok(())
}

#[tauri::command]
pub fn join_team_by_invite(invite_code: String, user_id: String, user_name: String) -> Result<Team, String> {
    let invites = INVITES.lock().map_err(|e| e.to_string())?;
    let invite = invites
        .iter()
        .find(|i| i.invite_code == invite_code)
        .ok_or("Invalid invite code")?;

    if invite.expires_at < now_ms() {
        return Err("Invite code has expired".to_string());
    }

    let team_id = invite.team_id.clone();
    let role = invite.role.clone();
    drop(invites);

    // Add member
    let mut members = MEMBERS.lock().map_err(|e| e.to_string())?;
    members.retain(|m| !(m.team_id == team_id && m.user_id == user_id));
    members.push(TeamMember {
        team_id: team_id.clone(),
        user_id,
        user_name,
        role,
        joined_at: now_ms(),
        last_seen_at: Some(now_ms()),
    });

    // Return team
    let teams = TEAMS.lock().map_err(|e| e.to_string())?;
    let team = teams
        .iter()
        .find(|t| t.id == team_id)
        .cloned()
        .ok_or("Team not found")?;

    Ok(team)
}
