// the file system access api is still a wicg draft, so typescript's dom
// library only knows the parts that made it into the standard. this fills
// in the pickers, the permission calls and the drag and drop handles

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
  id?: string;
  startIn?: FileSystemHandle | string;
}

interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite';
  id?: string;
  startIn?: FileSystemHandle | string;
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null>;
}
