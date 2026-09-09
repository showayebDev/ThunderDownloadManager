import { Browser, Call, Events, Window } from '@wailsio/runtime';
import {
  DownloadCommand,
  FileCommand,
  QueueCommand,
  SystemCommand,
  WindowCommand,
} from '../../bindings/ThunderDM/src-wails3/commands/index.ts';

export async function BrowserOpenURL(url: string) {
  try {
    await Browser.OpenURL(url);
  } catch (err) {
    console.error('Failed to open URL in browser:', err);
    window.open(url, '_blank');
  }
}

// Wails v3 IPC bridge for frontend-backend communication
export async function invoke<T = any>(cmd: string, args?: any): Promise<T> {
  console.log(`[tauriBridge] invoke called with cmd: "${cmd}", args:`, args);
  try {
    switch (cmd) {
      // Window commands
      case 'open_download_confirmation_window_command':
        return (await WindowCommand.OpenDownloadConfirmationWindowCommand({ payload: args?.payload || args })) as T;
      case 'open_realtime_progress_window_command':
        return (await WindowCommand.OpenRealtimeProgressWindowCommand(args)) as T;
      case 'get_download_confirmation_payload':
      case 'get_latest_download_confirmation_payload': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.GetDownloadConfirmationPayload', wId)) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.GetDownloadConfirmationPayload', wId)) as T;
          } catch {}
        }
        return (await WindowCommand.GetLatestDownloadConfirmationPayload()) as T;
      }
      case 'get_download_completed_payload':
      case 'get_latest_download_completed_payload': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || args?.taskId || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.GetDownloadCompletedPayload', wId)) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.GetDownloadCompletedPayload', wId)) as T;
          } catch {}
        }
        return (await WindowCommand.GetLatestDownloadCompletedPayload()) as T;
      }
      case 'get_latest_realtime_progress_payload':
        return (await WindowCommand.GetLatestRealtimeProgressPayload()) as T;
      case 'clear_download_completed_payload': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || args?.taskId || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.ClearDownloadCompletedPayloadWithId', wId)) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.ClearDownloadCompletedPayloadWithId', wId)) as T;
          } catch {}
        }
        return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.ClearDownloadCompletedPayload')) as T;
      }
      case 'close_download_completed_window_command': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || args?.taskId || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.CloseDownloadCompletedWindowCommand', { id: wId })) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.CloseDownloadCompletedWindowCommand', { id: wId })) as T;
          } catch {}
        }
        return (await WindowCommand.Close()) as T;
      }
      case 'clear_download_confirmation_payload': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.ClearDownloadConfirmationPayloadWithId', wId)) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.ClearDownloadConfirmationPayloadWithId', wId)) as T;
          } catch {}
        }
        return (await WindowCommand.ClearDownloadConfirmationPayload()) as T;
      }
      case 'clear_realtime_progress_payload':
        return (await WindowCommand.ClearRealtimeProgressPayload()) as T;
      case 'close_download_confirmation_window_command': {
        const wId = typeof args === 'string' ? args : (args?.windowId || args?.id || '');
        if (wId) {
          try {
            return (await (Call as any).ByName('ThunderDM/src-wails3/commands.WindowCommand.CloseDownloadConfirmationWindowCommand', wId)) as T;
          } catch {}
          try {
            return (await (Call as any).ByName('main.WindowCommand.CloseDownloadConfirmationWindowCommand', wId)) as T;
          } catch {}
        }
        return (await WindowCommand.Close()) as T;
      }
      case 'close_realtime_progress_window_command':
        return (await WindowCommand.CloseRealtimeProgressWindowCommand(args?.id ? args : { id: args })) as T;
      case 'hide_realtime_download_to_tray_command':
        return (await WindowCommand.HideRealtimeDownloadToTrayCommand(args)) as T;
      case 'remove_hidden_download_command':
        return (await WindowCommand.RemoveHiddenDownloadCommand(args?.id ? args : { id: args })) as T;
      case 'minimize_window':
        return (await WindowCommand.Minimize()) as T;
      case 'close_window':
        return (await WindowCommand.Close()) as T;

      // File / Storage commands (Pure SQLite Backend)
      case 'save_thunderdb_file_command':
        return (await FileCommand.SaveThunderdbFileCommand(args)) as T;
      case 'read_thunderdb_file_command':
        return (await FileCommand.ReadThunderdbFileCommand(args)) as T;
      case 'set_storage_mode_command':
        return undefined as T;
      case 'get_storage_mode_command':
        return 'sqlite' as T;
      case 'open_file_command':
      case 'open_file': {
        const fp = typeof args === 'string' ? args : (args?.filePath || args?.path || args?.file_path || '');
        return (await FileCommand.OpenFile(fp)) as T;
      }
      case 'open_folder_command':
      case 'open_folder': {
        const fp = typeof args === 'string' ? args : (args?.filePath || args?.path || args?.file_path || '');
        return (await FileCommand.OpenFolder(fp)) as T;
      }
      case 'delete_file_from_disk_command':
      case 'delete_file':
        return (await FileCommand.DeleteFile(args?.filePath || args?.path || '')) as T;
      case 'calculate_checksum_command':
      case 'calculate_checksum':
        return (await FileCommand.CalculateChecksum(args?.filePath || args?.path || '', args?.algo || args?.algorithm || 'sha256')) as T;
      case 'resolve_unique_filename_command':
        return (await FileCommand.ResolveUniqueFilename(args?.save_path || args?.savePath || '', args?.filename || '')) as T;
      case 'pick_folder_command':
        return (await FileCommand.PickFolder()) as T;
      case 'get_default_download_dir':
      case 'get_default_download_directory':
        return (await FileCommand.GetDefaultDownloadDir()) as T;
      case 'check_files_exist_command':
      case 'check_files_exist':
        return (await FileCommand.CheckFilesExistCommand(args?.paths ? args : { paths: Array.isArray(args) ? args : [args] })) as T;
      case 'check_files_info_command':
      case 'check_files_info': {
        const payload = args?.paths ? args : { paths: Array.isArray(args) ? args : [args] };
        try {
          return (await (Call as any).ByName('ThunderDM/src-wails3/commands.FileCommand.CheckFilesInfoCommand', payload)) as T;
        } catch {}
        try {
          return (await (Call as any).ByName('main.FileCommand.CheckFilesInfoCommand', payload)) as T;
        } catch {}
        return null as unknown as T;
      }

      // Download commands
      case 'start_download': {
        let proto = args?.protocol ?? null;
        const checksum = args?.checksum || args?.givenCheckSum || args?.expectedChecksum || args?.given_checksum;
        if (checksum && typeof checksum === 'string' && checksum.trim()) {
          proto = `${proto || 'Auto'}::checksum=${encodeURIComponent(checksum.trim())}`;
        }
        const u = args?.username || args?.authUsername || '';
        const p = args?.password || args?.authPassword || '';
        const ua = args?.userAgent || args?.user_agent || '';
        const ref = args?.referer || args?.referrer || '';
        const cookie = args?.cookies || args?.cookie || '';
        if (u || p) {
          proto = `${proto || 'Auto'}::auth=${encodeURIComponent(u)}:${encodeURIComponent(p)}`;
        }
        if (ua) {
          proto = `${proto || 'Auto'}::ua=${encodeURIComponent(ua)}`;
        }
        if (ref) {
          proto = `${proto || 'Auto'}::ref=${encodeURIComponent(ref)}`;
        }
        if (cookie) {
          proto = `${proto || 'Auto'}::cookie=${encodeURIComponent(cookie)}`;
        }
        const showComp = args?.showCompletionWindow ?? args?.show_completion ?? args?.showCompletion;
        if (showComp === false) {
          proto = `${proto || 'Auto'}::show_completion=false`;
        } else if (showComp === true) {
          proto = `${proto || 'Auto'}::show_completion=true`;
        }
        return (await DownloadCommand.Start(args?.id || '', args?.url || '', args?.save_path || args?.savePath || '', args?.filename || '', args?.thread_count ?? args?.threadCount ?? 0, args?.speed_limit ?? args?.speedLimit ?? null, proto)) as T;
      }
      case 'pause_download': {
        const targetId = typeof args === 'string' ? args : (args?.id || args?.taskId || '');
        return (await DownloadCommand.Pause(targetId)) as T;
      }
      case 'pause_all':
      case 'pause_all_command':
        return (await DownloadCommand.PauseAll()) as T;
      case 'resume_download': {
        let proto = args?.protocol ?? null;
        const checksum = args?.checksum || args?.givenCheckSum || args?.expectedChecksum || args?.given_checksum;
        if (checksum && typeof checksum === 'string' && checksum.trim()) {
          proto = `${proto || 'Auto'}::checksum=${encodeURIComponent(checksum.trim())}`;
        }
        const u = args?.username || args?.authUsername || '';
        const p = args?.password || args?.authPassword || '';
        const ua = args?.userAgent || args?.user_agent || '';
        const ref = args?.referer || args?.referrer || '';
        const cookie = args?.cookies || args?.cookie || '';
        if (u || p) {
          proto = `${proto || 'Auto'}::auth=${encodeURIComponent(u)}:${encodeURIComponent(p)}`;
        }
        if (ua) {
          proto = `${proto || 'Auto'}::ua=${encodeURIComponent(ua)}`;
        }
        if (ref) {
          proto = `${proto || 'Auto'}::ref=${encodeURIComponent(ref)}`;
        }
        if (cookie) {
          proto = `${proto || 'Auto'}::cookie=${encodeURIComponent(cookie)}`;
        }
        const showComp = args?.showCompletionWindow ?? args?.show_completion ?? args?.showCompletion;
        if (showComp === false) {
          proto = `${proto || 'Auto'}::show_completion=false`;
        } else if (showComp === true) {
          proto = `${proto || 'Auto'}::show_completion=true`;
        }
        return (await DownloadCommand.Resume(args?.id || '', args?.url || '', args?.save_path || args?.savePath || '', args?.filename || '', args?.thread_count ?? args?.threadCount ?? 0, args?.speed_limit ?? args?.speedLimit ?? null, proto)) as T;
      }
      case 'cancel_download': {
        const targetId = typeof args === 'string' ? args : (args?.id || args?.taskId || '');
        return (await DownloadCommand.Cancel(targetId)) as T;
      }
      case 'get_task_status':
        return (await DownloadCommand.GetTaskStatus(args?.id || '')) as T;
      case 'get_default_thread_count_command':
      case 'get_default_thread_count': {
        try {
          return (await (Call as any).ByName('ThunderDM/src-wails3/commands.DownloadCommand.GetDefaultThreadCount')) as T;
        } catch {}
        return (await (Call as any).ByName('main.DownloadCommand.GetDefaultThreadCount')) as T;
      }
      case 'get_engine_config_command':
      case 'get_engine_config': {
        try {
          return (await (Call as any).ByName('ThunderDM/src-wails3/commands.DownloadCommand.GetDefaultEngineConfig')) as T;
        } catch {}
        return (await (Call as any).ByName('main.DownloadCommand.GetDefaultEngineConfig')) as T;
      }
      case 'process_new_download':
        return (await DownloadCommand.ProcessNewDownload(args?.url || args || '')) as T;
      case 'fetch_file_info_command': {
        let targetUrl = typeof args === 'string' ? args : (args?.url || '');
        const u = args?.username || args?.authUsername || '';
        const p = args?.password || args?.authPassword || '';
        const ua = args?.userAgent || args?.user_agent || '';
        const ref = args?.referer || args?.referrer || '';
        const cookie = args?.cookies || args?.cookie || '';
        if (u || p) {
          targetUrl = `${targetUrl}::auth=${encodeURIComponent(u)}:${encodeURIComponent(p)}`;
        }
        if (ua) {
          targetUrl = `${targetUrl}::ua=${encodeURIComponent(ua)}`;
        }
        if (ref) {
          targetUrl = `${targetUrl}::ref=${encodeURIComponent(ref)}`;
        }
        if (cookie) {
          targetUrl = `${targetUrl}::cookie=${encodeURIComponent(cookie)}`;
        }
        return (await DownloadCommand.FetchFileInfo(targetUrl)) as T;
      }
      case 'update_task_thread_count_command':
        return (await DownloadCommand.UpdateThreadCount(args?.id || '', args?.thread_count ?? args?.threadCount ?? args?.threads ?? 0)) as T;
      case 'update_task_speed_limit_command':
      case 'update_speed_limit':
        return (await DownloadCommand.UpdateSpeedLimit(args?.id || '', args?.speed_limit ?? args?.speedLimit ?? null)) as T;
      case 'crawl_page_links_command':
      case 'crawl_page_links': {
        const payload = typeof args === 'string' ? args : JSON.stringify(args);
        if (typeof (DownloadCommand as any).CrawlPageLinks === 'function') {
          return (await (DownloadCommand as any).CrawlPageLinks(payload)) as T;
        }
        return (await (Call as any).ByName('main.DownloadCommand.CrawlPageLinks', payload)) as T;
      }
      case 'probe_file_sizes_command':
      case 'probe_file_sizes': {
        const urls = Array.isArray(args) ? args : (args?.urls || []);
        if (typeof (DownloadCommand as any).ProbeFileSizes === 'function') {
          return (await (DownloadCommand as any).ProbeFileSizes(urls)) as T;
        }
        return (await (Call as any).ByName('main.DownloadCommand.ProbeFileSizes', urls)) as T;
      }

      // Queue commands
      case 'get_queues_command':
      case 'fetch_queue_command':
        return (await QueueCommand.FetchQueue()) as T;
      case 'update_queue_command':
        return (await QueueCommand.UpdateQueue(args?.config || args)) as T;

      // System commands
      case 'shutdown':
        return (await SystemCommand.Shutdown()) as T;
      case 'sleep':
        return (await SystemCommand.Sleep()) as T;
      case 'hibernate':
        return (await SystemCommand.Hibernate()) as T;
      case 'check_ytdlp':
      case 'check_media_tools':
      case 'check_media_engines':
        return (await SystemCommand.CheckYTDLP()) as T;
      case 'check_ytdlp_update':
      case 'check_media_tools_update':
      case 'check_media_engines_update':
        return (await (SystemCommand as any).CheckYTDLPUpdate()) as T;
      case 'install_ytdlp':
      case 'install_media_tools':
      case 'install_media_engines':
        return (await SystemCommand.InstallYTDLP()) as T;
      case 'open_url':
      case 'open_external_url':
        return (await BrowserOpenURL(args?.url || args)) as T;

      // App Updater commands
      case 'get_app_version':
        return (await SystemCommand.GetAppVersion()) as T;
      case 'check_app_update':
        return (await SystemCommand.CheckAppUpdate()) as T;
      case 'install_app_update':
        return (await SystemCommand.InstallAppUpdate()) as T;
      case 'restart_app_for_update':
        return (await SystemCommand.RestartAppForUpdate()) as T;
      case 'launch_app_update_flow':
        return (await SystemCommand.LaunchAppUpdateFlow()) as T;
      case 'get_open_source_backend_info':
      case 'get_backend_dependencies':
        if (typeof (SystemCommand as any).GetOpenSourceBackendInfo === 'function') {
          return (await (SystemCommand as any).GetOpenSourceBackendInfo()) as T;
        } else if (typeof (SystemCommand as any).GetOpenSourceBackendInfoCommand === 'function') {
          return (await (SystemCommand as any).GetOpenSourceBackendInfoCommand()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.GetOpenSourceBackendInfo')) as T;

      // Proxy commands
      case 'open_system_proxy_settings_command':
      case 'open_system_proxy_settings':
        if (typeof (SystemCommand as any).OpenSystemProxySettings === 'function') {
          return (await (SystemCommand as any).OpenSystemProxySettings()) as T;
        } else if (typeof (SystemCommand as any).OpenSystemProxySettingsCommand === 'function') {
          return (await (SystemCommand as any).OpenSystemProxySettingsCommand()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.OpenSystemProxySettings')) as T;

      case 'get_proxy_config_command':
      case 'get_proxy_config':
        if (typeof (SystemCommand as any).GetProxyConfig === 'function') {
          return (await (SystemCommand as any).GetProxyConfig()) as T;
        } else if (typeof (SystemCommand as any).GetProxyConfigCommand === 'function') {
          return (await (SystemCommand as any).GetProxyConfigCommand()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.GetProxyConfig')) as T;

      case 'set_proxy_config_command':
      case 'set_proxy_config':
        if (typeof (SystemCommand as any).SetProxyConfig === 'function') {
          return (await (SystemCommand as any).SetProxyConfig(args)) as T;
        } else if (typeof (SystemCommand as any).SetProxyConfigCommand === 'function') {
          return (await (SystemCommand as any).SetProxyConfigCommand(args)) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.SetProxyConfig', args)) as T;

      case 'test_proxy_connection_command':
      case 'test_proxy_connection':
      case 'test_proxy':
        if (typeof (SystemCommand as any).TestProxyConnection === 'function') {
          return (await (SystemCommand as any).TestProxyConnection(args)) as T;
        } else if (typeof (SystemCommand as any).TestProxyConnectionCommand === 'function') {
          return (await (SystemCommand as any).TestProxyConnectionCommand(args)) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.TestProxyConnection', args)) as T;

      case 'set_server_port_command':
      case 'set_server_port':
        if (typeof (SystemCommand as any).SetServerPortCommand === 'function') {
          return (await (SystemCommand as any).SetServerPortCommand(typeof args === 'string' ? { port: args } : args)) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.SetServerPortCommand', typeof args === 'string' ? { port: args } : args)) as T;

      case 'set_browser_integration_command':
      case 'set_browser_integration':
        if (typeof (SystemCommand as any).SetBrowserIntegrationCommand === 'function') {
          return (await (SystemCommand as any).SetBrowserIntegrationCommand(typeof args === 'boolean' ? { enabled: args } : args)) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.SetBrowserIntegrationCommand', typeof args === 'boolean' ? { enabled: args } : args)) as T;

      case 'is_launch_on_startup_enabled_command':
      case 'is_launch_on_startup_enabled':
        if (typeof (SystemCommand as any).IsLaunchOnStartupEnabledCommand === 'function') {
          return (await (SystemCommand as any).IsLaunchOnStartupEnabledCommand()) as T;
        } else if (typeof (SystemCommand as any).IsLaunchOnStartupEnabled === 'function') {
          return (await (SystemCommand as any).IsLaunchOnStartupEnabled()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.IsLaunchOnStartupEnabled')) as T;

      case 'set_launch_on_startup_command':
      case 'set_launch_on_startup':
        if (typeof (SystemCommand as any).SetLaunchOnStartupCommand === 'function') {
          return (await (SystemCommand as any).SetLaunchOnStartupCommand(typeof args === 'boolean' ? { enabled: args } : args)) as T;
        } else if (typeof (SystemCommand as any).SetLaunchOnStartup === 'function') {
          return (await (SystemCommand as any).SetLaunchOnStartup(typeof args === 'boolean' ? args : Boolean(args?.enabled))) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.SetLaunchOnStartupCommand', typeof args === 'boolean' ? { enabled: args } : args)) as T;

      case 'get_server_port_command':
      case 'get_server_port':
        if (typeof (SystemCommand as any).GetServerPortCommand === 'function') {
          return (await (SystemCommand as any).GetServerPortCommand()) as T;
        } else if (typeof (SystemCommand as any).GetServerPort === 'function') {
          return (await (SystemCommand as any).GetServerPort()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.GetServerPort')) as T;

      case 'purge_all_user_data_command':
      case 'purge_all_user_data':
        if (typeof (SystemCommand as any).PurgeAllUserDataCommand === 'function') {
          return (await (SystemCommand as any).PurgeAllUserDataCommand()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.PurgeAllUserDataCommand')) as T;

      case 'get_system_fonts_command':
      case 'get_system_fonts':
        if (typeof (SystemCommand as any).GetSystemFonts === 'function') {
          return (await (SystemCommand as any).GetSystemFonts()) as T;
        } else if (typeof (SystemCommand as any).GetSystemFontsCommand === 'function') {
          return (await (SystemCommand as any).GetSystemFontsCommand()) as T;
        }
        return (await (Call as any).ByName('main.SystemCommand.GetSystemFonts')) as T;

      default:
        return null as unknown as T;
    }
  } catch (err) {
    console.warn(`[WailsBridge] Command execution failed: ${cmd}`, args, err);
    return null as unknown as T;
  }
}

// Event listener wrapper for Wails v3 runtime
export async function listen<T = any>(event: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  const cancel = Events.On(event, (data: any) => {
    callback({ payload: data.data });
  });
  return () => {
    cancel();
  };
}

// Window control actions
export async function WindowMinimise() {
  await Window.Minimise();
}

export async function WindowToggleMaximise() {
  await Window.ToggleMaximise();
}

export async function WindowFullscreen() {
  await Window.Fullscreen();
}

export async function WindowToggleFullscreen() {
  await Window.ToggleFullscreen();
}

export async function WindowHide() {
  await Window.Hide();
}

export async function Quit() {
  await Window.Close();
}

export async function ExitApp() {
  try {
    await WindowCommand.ExitApp();
  } catch (err) {
    await Window.Close();
  }
}

