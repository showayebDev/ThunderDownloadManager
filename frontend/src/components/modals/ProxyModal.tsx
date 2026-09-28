import React, { useState, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Activity,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Shield,
  Check,
  X,
} from 'lucide-react';
import { invoke } from '../../utils/tauriBridge';
import { HelpTooltip } from '../common/Tooltip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export type ProxyMode = 'none' | 'system' | 'pac' | 'manual';
export type ProxyType = 'HTTP' | 'SOCKS';

export interface ProxyConfig {
  mode: ProxyMode;
  pacUrl: string;
  proxyType: ProxyType;
  host: string;
  port: string;
  useAuth: boolean;
  username: string;
  password: string;
  bypassList: string;
}

export interface ProxyTestResult {
  success: boolean;
  message: string;
  ip?: string;
  latencyMs?: number;
  error?: string;
}

export const defaultProxyConfig: ProxyConfig = {
  mode: 'none',
  pacUrl: '',
  proxyType: 'HTTP',
  host: '',
  port: '',
  useAuth: false,
  username: '',
  password: '',
  bypassList: 'example.com 192.168.1.*',
};

interface ProxyModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ProxyConfig;
  onSave: (newConfig: ProxyConfig) => void;
}

export const ProxyModal: React.FC<ProxyModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [mode, setMode] = useState<ProxyMode>(config?.mode || 'none');
  const [pacUrl, setPacUrl] = useState(config?.pacUrl || '');
  const [proxyType, setProxyType] = useState<ProxyType>(config?.proxyType || 'HTTP');
  const [host, setHost] = useState(config?.host || '');
  const [port, setPort] = useState(config?.port || '');
  const [useAuth, setUseAuth] = useState(config?.useAuth || false);
  const [username, setUsername] = useState(config?.username || '');
  const [password, setPassword] = useState(config?.password || '');
  const [bypassList, setBypassList] = useState(config?.bypassList || 'example.com 192.168.1.*');

  // Probe and test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);

  const isManualOrPac = mode === 'manual' || mode === 'pac';
  const isTestedAndValid = testResult?.success === true;
  const canSave = !isManualOrPac || isTestedAndValid;

  // Sync modal fields on open
  useEffect(() => {
    if (isOpen && config) {
      setMode(config.mode || 'none');
      setPacUrl(config.pacUrl || '');
      setProxyType(config.proxyType || 'HTTP');
      setHost(config.host || '');
      setPort(config.port || '');
      setUseAuth(config.useAuth || false);
      setUsername(config.username || '');
      setPassword(config.password || '');
      setBypassList(config.bypassList || 'example.com 192.168.1.*');
      setTestResult(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const handleOpenSystemProxySettings = async () => {
    try {
      await invoke('open_system_proxy_settings_command');
    } catch (err) {
      console.error('Failed to open system proxy settings:', err);
    }
  };

  const handlePortIncrement = () => {
    const num = parseInt(port, 10);
    if (!isNaN(num) && num < 65535) {
      setPort(String(num + 1));
      setTestResult(null);
    }
  };

  const handlePortDecrement = () => {
    const num = parseInt(port, 10);
    if (!isNaN(num) && num > 1) {
      setPort(String(num - 1));
      setTestResult(null);
    }
  };

  const handleTestProxy = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const probeConfig: ProxyConfig = {
        mode,
        pacUrl: pacUrl.trim(),
        proxyType,
        host: host.trim() || '127.0.0.1',
        port: port.trim() || '2080',
        useAuth,
        username: username.trim(),
        password,
        bypassList: bypassList.trim(),
      };
      const res = await invoke<ProxyTestResult>('test_proxy_connection_command', probeConfig);
      if (res) {
        setTestResult(res);
      } else {
        setTestResult({
          success: false,
          message: 'No response from proxy test service.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: 'Proxy test failed.',
        error: err?.message || String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (isManualOrPac && !isTestedAndValid) {
      return;
    }
    const newConfig: ProxyConfig = {
      mode,
      pacUrl: pacUrl.trim(),
      proxyType,
      host: mode === 'manual' ? (host.trim() || '127.0.0.1') : host.trim(),
      port: mode === 'manual' ? (port.trim() || '2080') : port.trim(),
      useAuth,
      username: username.trim(),
      password,
      bypassList: bypassList.trim(),
    };
    onSave(newConfig);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-xl w-full max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                Proxy Configuration
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure network proxy servers, PAC scripts, and bypass rules
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Options list */}
        <div className="p-5 space-y-3.5 flex-1 overflow-y-auto custom-scrollbar text-xs">
          {/* Direct connection */}
          <div
            onClick={() => {
              setMode('none');
              setTestResult(null);
            }}
            className={`cursor-pointer rounded-xl transition-all ${
              mode === 'none'
                ? 'border border-primary/40 bg-muted/50 p-3.5 shadow-xs'
                : 'p-2.5 hover:bg-accent/40 rounded-xl'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                    mode === 'none'
                      ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                      : 'border-border bg-background'
                  }`}
                >
                  {mode === 'none' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-xs" />
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  mode === 'none' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                No Proxy (Direct Connection)
              </span>
            </div>
          </div>

          {/* System proxy */}
          <div
            onClick={() => {
              setMode('system');
              setTestResult(null);
            }}
            className={`cursor-pointer rounded-xl transition-all ${
              mode === 'system'
                ? 'border border-primary/40 bg-muted/50 p-3.5 space-y-3.5 shadow-xs'
                : 'p-2.5 hover:bg-accent/40 rounded-xl'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                    mode === 'system'
                      ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                      : 'border-border bg-background'
                  }`}
                >
                  {mode === 'system' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-xs" />
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  mode === 'system' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                System Proxy
              </span>
            </div>

            {mode === 'system' && (
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenSystemProxySettings();
                  }}
                  className="w-full text-xs"
                >
                  Open System Proxy Settings
                </Button>
              </div>
            )}
          </div>

          {/* PAC script */}
          <div
            onClick={() => {
              setMode('pac');
              setTestResult(null);
            }}
            className={`cursor-pointer rounded-xl transition-all ${
              mode === 'pac'
                ? 'border border-primary/40 bg-muted/50 p-3.5 space-y-3.5 shadow-xs'
                : 'p-2.5 hover:bg-accent/40 rounded-xl'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                    mode === 'pac'
                      ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                      : 'border-border bg-background'
                  }`}
                >
                  {mode === 'pac' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-xs" />
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  mode === 'pac' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                Proxy Auto Configuration (PAC)
              </span>
            </div>

            {mode === 'pac' && (
              <div className="space-y-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                <Label className="text-[11px] font-medium text-muted-foreground block">
                  Proxy Auto Configuration URL
                </Label>
                <Input
                  type="text"
                  value={pacUrl}
                  onChange={(e) => {
                    setPacUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="http://localhost/some.pac"
                  className="w-full bg-background border-border text-foreground font-mono text-xs"
                />
              </div>
            )}
          </div>

          {/* Manual proxy */}
          <div
            onClick={() => {
              setMode('manual');
              setTestResult(null);
            }}
            className={`cursor-pointer rounded-xl transition-all ${
              mode === 'manual'
                ? 'border border-primary/40 bg-muted/50 p-3.5 space-y-3.5 shadow-xs'
                : 'p-2.5 hover:bg-accent/40 rounded-xl'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className="relative flex items-center justify-center">
                <div
                  className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                    mode === 'manual'
                      ? 'border-primary bg-primary/20 ring-2 ring-primary/30'
                      : 'border-border bg-background'
                  }`}
                >
                  {mode === 'manual' && (
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-xs" />
                  )}
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  mode === 'manual' ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                Manual Proxy
              </span>
            </div>

            {mode === 'manual' && (
              <div className="space-y-3.5 pt-1" onClick={(e) => e.stopPropagation()}>
                {/* Protocol type */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground block">
                    Proxy type
                  </Label>
                  <div className="inline-flex bg-background border border-border p-0.5 rounded-lg space-x-1">
                    <button
                      type="button"
                      onClick={() => {
                        setProxyType('HTTP');
                        setTestResult(null);
                      }}
                      className={`px-4 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                        proxyType === 'HTTP'
                          ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      HTTP
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProxyType('SOCKS');
                        setTestResult(null);
                      }}
                      className={`px-4 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                        proxyType === 'SOCKS'
                          ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      SOCKS
                    </button>
                  </div>
                </div>

                {/* Host and port */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-medium text-muted-foreground block">
                    Address & Port
                  </Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      type="text"
                      value={host}
                      onChange={(e) => {
                        setHost(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder="127.0.0.1"
                      className="flex-1 bg-background border-border text-foreground font-mono text-xs"
                    />
                    <span className="text-muted-foreground font-bold">:</span>
                    <div className="relative flex items-center w-28 bg-background border border-border rounded-lg overflow-hidden focus-within:border-primary">
                      <input
                        type="text"
                        value={port}
                        onChange={(e) => {
                          setPort(e.target.value);
                          setTestResult(null);
                        }}
                        placeholder="2080"
                        className="w-full bg-transparent px-3 py-1.5 text-xs text-foreground outline-none text-center font-mono"
                      />
                      <div className="flex flex-col border-l border-border bg-muted/40 divide-y divide-border">
                        <button
                          type="button"
                          onClick={handlePortIncrement}
                          className="px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={handlePortDecrement}
                          className="px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Credentials */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center space-x-2 cursor-pointer">
                    <Checkbox
                      id="proxy-use-auth"
                      checked={useAuth}
                      onCheckedChange={(checked) => {
                        setUseAuth(Boolean(checked));
                        setTestResult(null);
                      }}
                    />
                    <Label htmlFor="proxy-use-auth" className="text-xs text-foreground font-medium cursor-pointer">
                      Use Authentication
                    </Label>
                  </div>

                  {useAuth && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <Input
                        type="text"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          setTestResult(null);
                        }}
                        placeholder="Username"
                        className="bg-background border-border text-foreground text-xs"
                      />
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setTestResult(null);
                        }}
                        placeholder="Password"
                        className="bg-background border-border text-foreground text-xs"
                      />
                    </div>
                  )}
                </div>

                {/* Bypass rules */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center space-x-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground">
                      Don't use proxy for
                    </Label>
                    <HelpTooltip description="Enter space-separated hosts or wildcards that should connect directly without proxy (e.g. example.com 192.168.1.*)." />
                  </div>
                  <Input
                    type="text"
                    value={bypassList}
                    onChange={(e) => {
                      setBypassList(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="example.com 192.168.1.*"
                    className="w-full bg-background border-border text-foreground font-mono text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Test status feedback */}
          {testResult ? (
            <div
              className={`p-3 rounded-xl text-xs flex items-start space-x-2.5 animate-in fade-in duration-150 ${
                testResult.success
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 flex-1">
                <div className="font-semibold flex items-center justify-between">
                  <span>{testResult.message}</span>
                  {testResult.success && testResult.latencyMs !== undefined && (
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                      {testResult.latencyMs}ms
                    </span>
                  )}
                </div>
                {testResult.error && (
                  <div className="text-[11px] opacity-80 font-mono break-all">
                    {testResult.error}
                  </div>
                )}
                {testResult.success && (
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ Connection verified! You can now save this proxy.
                  </div>
                )}
              </div>
            </div>
          ) : isManualOrPac ? (
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-600 dark:text-amber-300 flex items-center space-x-2 animate-in fade-in duration-150">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-[11px]">
                Proxy connection must be tested and verified (<strong>OK</strong>) before saving.
              </span>
            </div>
          ) : null}
        </div>

        {/* Docked Action buttons */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-between gap-3 shrink-0 select-none">
          {/* Test connection */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestProxy}
            disabled={testing}
            className="flex items-center gap-1.5 text-xs h-8 rounded-lg"
          >
            {testing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>Testing...</span>
              </>
            ) : (
              <>
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span>Test Proxy</span>
              </>
            )}
          </Button>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-8 rounded-lg px-4"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave || testing}
              size="sm"
              className="text-xs font-medium px-5 h-8 rounded-lg shadow-sm"
            >
              {canSave && isManualOrPac && <Check className="w-3.5 h-3.5 mr-1" />}
              <span>Save Proxy</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
