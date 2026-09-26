/**
 * Dialog modals for portable Media Tools (YT-DLP & FFmpeg) setup and Application Auto-Updates.
 */
import React from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from '../../common/MarkdownRenderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog';
import { Button } from '../../ui/button';
import { Progress } from '../../ui/progress';
import { Badge } from '../../ui/badge';
import {
  UpdateModalState,
  YtdlpModalState,
  formatHeaderBytes,
} from './useAppUpdater';

interface UpdateBannerModalProps {
  ytdlpModal: YtdlpModalState | null;
  setYtdlpModal: React.Dispatch<React.SetStateAction<YtdlpModalState | null>>;
  updateModal: UpdateModalState | null;
  setUpdateModal: React.Dispatch<React.SetStateAction<UpdateModalState | null>>;
  onInstallYTDLP: () => void;
  onStartAppUpdate: () => void;
  onRestartAppForUpdate: () => void;
  onDismissAppUpdate: () => void;
}

export const UpdateBannerModal: React.FC<UpdateBannerModalProps> = ({
  ytdlpModal,
  setYtdlpModal,
  updateModal,
  setUpdateModal,
  onInstallYTDLP,
  onStartAppUpdate,
  onRestartAppForUpdate,
  onDismissAppUpdate,
}) => {
  return (
    <>
      {/* Media tools setup modal using shadcn Dialog */}
      {ytdlpModal?.open && (
        <Dialog
          open={ytdlpModal.open}
          onOpenChange={(open) => {
            if (
              !open &&
              !ytdlpModal.loading &&
              (!ytdlpModal.isMandatorySetup || ytdlpModal.success)
            ) {
              setYtdlpModal(null);
            }
          }}
        >
          <DialogContent className="max-w-[440px] p-6 space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  ytdlpModal.loading
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : ytdlpModal.success
                    ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
                }`}
              >
                {ytdlpModal.loading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : ytdlpModal.success ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>

              <DialogHeader>
                <DialogTitle className="text-center text-base font-semibold">
                  {ytdlpModal.title}
                </DialogTitle>
                <DialogDescription className="text-center text-xs text-muted-foreground leading-relaxed break-words px-2">
                  {ytdlpModal.message}
                </DialogDescription>
              </DialogHeader>
            </div>

            {ytdlpModal.loading && (
              <div className="space-y-2 pt-1">
                <Progress
                  value={Math.min(100, Math.max(ytdlpModal.progressPercent || 0, 5))}
                  className="h-2"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>
                    {ytdlpModal.progressPercent !== undefined && ytdlpModal.progressPercent > 0
                      ? `${ytdlpModal.progressPercent}%`
                      : 'Please wait...'}
                  </span>
                  <span>
                    {ytdlpModal.downloadedBytes &&
                    ytdlpModal.totalBytes &&
                    ytdlpModal.totalBytes > 0
                      ? `${formatHeaderBytes(ytdlpModal.downloadedBytes)} / ${formatHeaderBytes(
                          ytdlpModal.totalBytes
                        )}`
                      : ytdlpModal.downloadedBytes && ytdlpModal.downloadedBytes > 0
                      ? formatHeaderBytes(ytdlpModal.downloadedBytes)
                      : ytdlpModal.stage || 'Downloading package...'}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter className="sm:justify-center gap-2 pt-2">
              {ytdlpModal.canInstall && (
                <Button
                  disabled={ytdlpModal.loading}
                  onClick={onInstallYTDLP}
                  className="w-full h-9 rounded-lg font-medium"
                >
                  {ytdlpModal.loading ? 'Installing...' : 'Install Media Tools Now'}
                </Button>
              )}
              {(!ytdlpModal.isMandatorySetup || ytdlpModal.success) && (
                <Button
                  disabled={ytdlpModal.loading}
                  variant={ytdlpModal.canInstall ? 'outline' : 'default'}
                  onClick={() => setYtdlpModal(null)}
                  className="w-full h-9 rounded-lg font-medium"
                >
                  {ytdlpModal.loading ? 'Working...' : ytdlpModal.success ? 'Get Started' : 'OK'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* App update dialog using shadcn Dialog */}
      {updateModal?.open && (
        <Dialog
          open={updateModal.open}
          onOpenChange={(open) => {
            if (!open && updateModal.stage !== 'checking' && updateModal.stage !== 'downloading') {
              setUpdateModal(null);
              onDismissAppUpdate();
            }
          }}
        >
          <DialogContent className="max-w-[480px] p-6 space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  updateModal.stage === 'checking' || updateModal.stage === 'downloading'
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : updateModal.stage === 'uptodate' || updateModal.stage === 'ready'
                    ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                    : updateModal.stage === 'available'
                    ? 'bg-primary/10 p-2.5 border border-primary/20 shadow-sm'
                    : 'bg-destructive/15 text-destructive border border-destructive/25'
                }`}
              >
                {updateModal.stage === 'checking' || updateModal.stage === 'downloading' ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : updateModal.stage === 'uptodate' || updateModal.stage === 'ready' ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : updateModal.stage === 'available' ? (
                  <img src="/icon.svg" alt="Logo" className="w-7 h-7 rounded-lg object-contain" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>

              <DialogHeader>
                <DialogTitle className="text-center text-base font-semibold">
                  {updateModal.title}
                </DialogTitle>
                <DialogDescription className="text-center text-xs text-muted-foreground leading-relaxed break-words px-2">
                  {updateModal.message}
                </DialogDescription>
              </DialogHeader>
            </div>

            {updateModal.stage === 'available' && (
              <div className="bg-muted/40 border border-border/80 rounded-xl p-3.5 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">Current Version:</span>
                  <span className="font-mono font-medium">v{updateModal.currentVersion}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">Latest Version:</span>
                  <Badge
                    variant="outline"
                    className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px]"
                  >
                    v{updateModal.latestVersion}
                  </Badge>
                </div>
                {updateModal.artifactSize && updateModal.artifactSize > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">Download Size:</span>
                    <span className="font-mono font-medium">
                      {formatHeaderBytes(updateModal.artifactSize)}
                    </span>
                  </div>
                ) : null}
                {updateModal.releaseNotes && (
                  <div className="pt-2 border-t border-border/70 space-y-1.5 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-foreground">
                        Release Notes:
                      </span>
                      {updateModal.publishedAt && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(updateModal.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar bg-background/90 p-3 rounded-lg border border-border/80 text-foreground font-sans text-xs leading-relaxed select-text">
                      <MarkdownRenderer content={updateModal.releaseNotes} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {updateModal.stage === 'downloading' && (
              <div className="space-y-2 pt-1">
                <Progress value={updateModal.progressPercent || 0} className="h-2" />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>{updateModal.progressPercent || 0}%</span>
                  <span>
                    {updateModal.downloadedBytes && updateModal.totalBytes
                      ? `${formatHeaderBytes(updateModal.downloadedBytes)} / ${formatHeaderBytes(
                          updateModal.totalBytes
                        )}`
                      : 'Downloading...'}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-center pt-2">
              {updateModal.stage === 'available' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUpdateModal(null);
                      onDismissAppUpdate();
                    }}
                    className="flex-1 h-9 rounded-lg font-medium"
                  >
                    Later
                  </Button>
                  <Button
                    onClick={onStartAppUpdate}
                    className="flex-1 h-9 rounded-lg font-medium bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    Update Now
                  </Button>
                </>
              )}

              {updateModal.stage === 'ready' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUpdateModal(null);
                      onDismissAppUpdate();
                    }}
                    className="flex-1 h-9 rounded-lg font-medium"
                  >
                    Later
                  </Button>
                  <Button
                    onClick={onRestartAppForUpdate}
                    className="flex-1 h-9 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    Restart & Apply Update
                  </Button>
                </>
              )}

              {(updateModal.stage === 'uptodate' || updateModal.stage === 'error') && (
                <Button
                  onClick={() => {
                    setUpdateModal(null);
                    onDismissAppUpdate();
                  }}
                  className="w-full h-9 rounded-lg font-medium"
                >
                  OK
                </Button>
              )}

              {(updateModal.stage === 'checking' || updateModal.stage === 'downloading') && (
                <Button disabled className="w-full h-9 rounded-lg opacity-80">
                  Please wait...
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
