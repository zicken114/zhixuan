use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/* ───────────────────────────────────────────────
   Data structures
   ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub menu_items: Vec<PluginMenuItem>,
    pub slash_commands: Vec<PluginSlashCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginMenuItem {
    pub id: String,
    pub label: String,
    pub icon: Option<String>,
    pub context: String, // "clipboard", "screenshot", "global"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSlashCommand {
    pub command: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDef {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub permissions: Vec<String>,
    pub enabled: bool,
    pub manifest: PluginManifest,
    pub source_url: Option<String>,
    pub install_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub category: String,
    pub permissions: Vec<String>,
    pub download_url: String,
    pub icon_url: Option<String>,
    pub rating: f32,
    pub install_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSetting {
    pub plugin_id: String,
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

/* ───────────────────────────────────────────────
   In-memory stores
   ─────────────────────────────────────────────── */

static PLUGINS: Mutex<Vec<PluginDef>> = Mutex::new(Vec::new());
static SETTINGS: Mutex<Vec<PluginSetting>> = Mutex::new(Vec::new());

/* ───────────────────────────────────────────────
   Registry (mock market data for demo)
   ─────────────────────────────────────────────── */

fn get_registry_plugins() -> Vec<RegistryPlugin> {
    vec![
        RegistryPlugin {
            id: "blast-helper".to_string(),
            name: "BLAST Helper".to_string(),
            version: "1.2.0".to_string(),
            author: "张三".to_string(),
            description: "快速处理BLAST比对结果，支持一键发送到NCBI、生成进化树、导出CSV".to_string(),
            category: "学科专用".to_string(),
            permissions: vec!["clipboard".to_string(), "network".to_string(), "result_window".to_string()],
            download_url: "https://example.com/plugins/blast-helper.zip".to_string(),
            icon_url: None,
            rating: 4.5,
            install_count: 328,
        },
        RegistryPlugin {
            id: "molecule-drawer".to_string(),
            name: "Molecule Drawer".to_string(),
            version: "0.8.1".to_string(),
            author: "ChemDev".to_string(),
            description: "在对话中绘制化学分子结构式，支持SMILES和IUPAC命名".to_string(),
            category: "学科专用".to_string(),
            permissions: vec!["result_window".to_string(), "local_storage".to_string()],
            download_url: "https://example.com/plugins/molecule-drawer.zip".to_string(),
            icon_url: None,
            rating: 4.2,
            install_count: 156,
        },
        RegistryPlugin {
            id: "latex-formatter".to_string(),
            name: "LaTeX Formatter".to_string(),
            version: "2.1.0".to_string(),
            author: "TexTools".to_string(),
            description: "一键格式化LaTeX代码，自动补全环境、检查语法错误".to_string(),
            category: "写作增强".to_string(),
            permissions: vec!["clipboard".to_string(), "result_window".to_string()],
            download_url: "https://example.com/plugins/latex-formatter.zip".to_string(),
            icon_url: None,
            rating: 4.8,
            install_count: 1024,
        },
        RegistryPlugin {
            id: "citation-validator".to_string(),
            name: "Citation Validator".to_string(),
            version: "1.0.3".to_string(),
            author: "RefCheck".to_string(),
            description: "验证引用格式是否符合目标期刊要求，支持APA、MLA、Chicago等".to_string(),
            category: "文献工具".to_string(),
            permissions: vec!["network".to_string(), "result_window".to_string()],
            download_url: "https://example.com/plugins/citation-validator.zip".to_string(),
            icon_url: None,
            rating: 4.0,
            install_count: 89,
        },
        RegistryPlugin {
            id: "wordcloud-gen".to_string(),
            name: "Word Cloud Generator".to_string(),
            version: "1.1.0".to_string(),
            author: "VizLab".to_string(),
            description: "从文本生成词云图，支持自定义形状、颜色和字体".to_string(),
            category: "可视化".to_string(),
            permissions: vec!["clipboard".to_string(), "result_window".to_string(), "file_system".to_string()],
            download_url: "https://example.com/plugins/wordcloud-gen.zip".to_string(),
            icon_url: None,
            rating: 3.9,
            install_count: 210,
        },
    ]
}

/* ───────────────────────────────────────────────
   Commands
   ─────────────────────────────────────────────── */

#[tauri::command]
pub fn get_plugin_registry() -> Result<Vec<RegistryPlugin>, String> {
    Ok(get_registry_plugins())
}

#[tauri::command]
pub fn list_plugins(enabled_only: Option<bool>) -> Result<Vec<PluginDef>, String> {
    let plugins = PLUGINS.lock().map_err(|e| e.to_string())?;
    let enabled_only = enabled_only.unwrap_or(false);
    let results: Vec<PluginDef> = plugins
        .iter()
        .filter(|p| !enabled_only || p.enabled)
        .cloned()
        .collect();
    Ok(results)
}

#[tauri::command]
pub fn install_plugin(registry_id: String) -> Result<PluginDef, String> {
    let registry = get_registry_plugins();
    let reg_plugin = registry
        .into_iter()
        .find(|p| p.id == registry_id)
        .ok_or_else(|| format!("Plugin '{}' not found in registry", registry_id))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let manifest = PluginManifest {
        id: reg_plugin.id.clone(),
        name: reg_plugin.name.clone(),
        version: reg_plugin.version.clone(),
        author: reg_plugin.author.clone(),
        description: reg_plugin.description.clone(),
        permissions: reg_plugin.permissions.clone(),
        menu_items: vec![],
        slash_commands: vec![],
    };

    let plugin = PluginDef {
        id: reg_plugin.id.clone(),
        name: reg_plugin.name,
        version: reg_plugin.version,
        author: reg_plugin.author,
        description: reg_plugin.description,
        permissions: reg_plugin.permissions,
        enabled: true,
        manifest,
        source_url: Some(reg_plugin.download_url),
        install_path: None,
        created_at: now,
        updated_at: now,
    };

    let mut plugins = PLUGINS.lock().map_err(|e| e.to_string())?;
    // Remove existing if reinstalling
    plugins.retain(|p| p.id != plugin.id);
    plugins.push(plugin.clone());

    Ok(plugin)
}

#[tauri::command]
pub fn uninstall_plugin(id: String) -> Result<(), String> {
    let mut plugins = PLUGINS.lock().map_err(|e| e.to_string())?;
    plugins.retain(|p| p.id != id);

    let mut settings = SETTINGS.lock().map_err(|e| e.to_string())?;
    settings.retain(|s| s.plugin_id != id);

    Ok(())
}

#[tauri::command]
pub fn toggle_plugin(id: String, enabled: bool) -> Result<(), String> {
    let mut plugins = PLUGINS.lock().map_err(|e| e.to_string())?;
    if let Some(plugin) = plugins.iter_mut().find(|p| p.id == id) {
        plugin.enabled = enabled;
        plugin.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
    }
    Ok(())
}

#[tauri::command]
pub fn get_plugin_settings(plugin_id: String) -> Result<Vec<PluginSetting>, String> {
    let settings = SETTINGS.lock().map_err(|e| e.to_string())?;
    let results: Vec<PluginSetting> = settings
        .iter()
        .filter(|s| s.plugin_id == plugin_id)
        .cloned()
        .collect();
    Ok(results)
}

#[tauri::command]
pub fn set_plugin_setting(plugin_id: String, key: String, value: String) -> Result<(), String> {
    let mut settings = SETTINGS.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    if let Some(setting) = settings.iter_mut().find(|s| s.plugin_id == plugin_id && s.key == key) {
        setting.value = value;
        setting.updated_at = now;
    } else {
        settings.push(PluginSetting {
            plugin_id,
            key,
            value,
            updated_at: now,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn get_plugin_menu_items() -> Result<Vec<serde_json::Value>, String> {
    let plugins = PLUGINS.lock().map_err(|e| e.to_string())?;
    let mut items = Vec::new();

    for plugin in plugins.iter().filter(|p| p.enabled) {
        for menu_item in &plugin.manifest.menu_items {
            items.push(serde_json::json!({
                "plugin_id": plugin.id,
                "plugin_name": plugin.name,
                "menu_id": menu_item.id,
                "label": menu_item.label,
                "icon": menu_item.icon,
                "context": menu_item.context,
            }));
        }
    }

    Ok(items)
}
