import * as fs from 'fs/promises'
import * as path from 'path'

export interface StorageProvider {
  save(relativePath: string, data: Buffer | Uint8Array): Promise<void>
  read(relativePath: string): Promise<Buffer>
  delete(relativePath: string): Promise<void>
  exists(relativePath: string): Promise<boolean>
  getAbsolutePath(relativePath: string): string
}

class LocalStorageProvider implements StorageProvider {
  private basePath: string

  constructor() {
    this.basePath = path.resolve(process.env.STORAGE_LOCAL_PATH ?? './storage')
  }

  getAbsolutePath(relativePath: string): string {
    return path.join(this.basePath, relativePath)
  }

  async save(relativePath: string, data: Buffer | Uint8Array): Promise<void> {
    const absPath = this.getAbsolutePath(relativePath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, data)
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.getAbsolutePath(relativePath))
  }

  async delete(relativePath: string): Promise<void> {
    await fs.unlink(this.getAbsolutePath(relativePath))
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.getAbsolutePath(relativePath))
      return true
    } catch {
      return false
    }
  }
}

// Export a singleton storage instance
export const storage: StorageProvider = new LocalStorageProvider()
