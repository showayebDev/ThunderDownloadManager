import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';

interface DeleteConfirmModalProps {
  onClose: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ onClose }) => {
  const { selectedIds, deleteDownloads, closeModal } = useDownloadContext();
  const [deleteFromDisk, setDeleteFromDisk] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const selectedCount = selectedIds.size > 0 ? selectedIds.size : 1;

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      await deleteDownloads(idsToDelete, deleteFromDisk);
    } finally {
      setIsDeleting(false);
      closeModal();
      onClose();
    }
  };

  const handleCancel = () => {
    closeModal();
    onClose();
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent showCloseButton={false} className="max-w-md w-full p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                Confirm Deletion
              </DialogTitle>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to remove <strong className="text-foreground">{selectedCount}</strong> download {selectedCount > 1 ? 'tasks' : 'task'} from your list? This action cannot be undone.
          </p>

          <div className="flex items-center space-x-2.5 p-3 rounded-xl bg-muted/40 border border-border">
            <Checkbox
              id="delete-disk-check"
              checked={deleteFromDisk}
              onCheckedChange={(checked) => setDeleteFromDisk(Boolean(checked))}
            />
            <Label htmlFor="delete-disk-check" className="text-xs text-foreground font-medium cursor-pointer select-none">
              Also permanently delete file from storage disk
            </Label>
          </div>
        </div>

        {/* Docked Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-end gap-2.5 shrink-0 select-none">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isDeleting} className="text-xs h-8 px-4 rounded-lg">
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting} className="text-xs h-8 px-5 rounded-lg shadow-sm">
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
