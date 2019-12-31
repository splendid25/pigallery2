import {ConfigTemplateEntry, DefaultsJobs} from '../../../../common/entities/job/JobDTO';
import * as path from 'path';
import * as util from 'util';
import {promises as fsp} from 'fs';
import {Job} from './Job';
import {ProjectPath} from '../../../ProjectPath';
import {PhotoProcessing} from '../../fileprocessing/PhotoProcessing';
import {VideoProcessing} from '../../fileprocessing/VideoProcessing';
import * as rimraf from 'rimraf';

const LOG_TAG = '[TempFolderCleaningJob]';

const rimrafPR = util.promisify(rimraf);


export class TempFolderCleaningJob extends Job {
  public readonly Name = DefaultsJobs[DefaultsJobs['Temp Folder Cleaning']];
  public readonly ConfigTemplate: ConfigTemplateEntry[] = null;
  public readonly Supported = true;
  directoryQueue: string[] = [];
  private tempRootCleaned = false;


  protected async init() {
    this.tempRootCleaned = false;
    this.directoryQueue = [];
    this.directoryQueue.push(ProjectPath.TranscodedFolder);
  }


  protected async isValidFile(filePath: string): Promise<boolean> {
    if (PhotoProcessing.isPhoto(filePath)) {
      return PhotoProcessing.isValidConvertedPath(filePath);
    }

    if (VideoProcessing.isVideo(filePath)) {
      return VideoProcessing.isValidConvertedPath(filePath);
    }

    return false;
  }

  protected async isValidDirectory(filePath: string): Promise<boolean> {
    const originalPath = path.join(ProjectPath.ImageFolder,
      path.relative(ProjectPath.TranscodedFolder, filePath));
    try {
      await fsp.access(originalPath);
      return true;
    } catch (e) {
    }
    return false;
  }

  protected async readDir(dirPath: string): Promise<string[]> {
    return (await fsp.readdir(dirPath)).map(f => path.normalize(path.join(dirPath, f)));
  }

  protected async stepTempDirectory() {
    const files = await this.readDir(ProjectPath.TempFolder);
    const validFiles = [ProjectPath.TranscodedFolder, ProjectPath.FacesFolder];
    for (let i = 0; i < files.length; ++i) {
      if (validFiles.indexOf(files[i]) === -1) {
        this.Progress.log('processing: ' + files[i]);
        this.Progress.Processed++;
        if ((await fsp.stat(files[i])).isDirectory()) {
          await rimrafPR(files[i]);
        } else {
          await fsp.unlink(files[i]);
        }
      } else {
        this.Progress.log('skipping: ' + files[i]);
        this.Progress.Skipped++;
      }
    }



    return true;


  }

  protected async stepConvertedDirectory() {

    const filePath = this.directoryQueue.shift();
    const stat = await fsp.stat(filePath);

    this.Progress.Left = this.directoryQueue.length;
    if (stat.isDirectory()) {
      if (await this.isValidDirectory(filePath) === false) {
        this.Progress.log('processing: ' + filePath);
        this.Progress.Processed++;
        await rimrafPR(filePath);
      } else {
        this.Progress.log('skipping: ' + filePath);
        this.Progress.Skipped++;
        this.directoryQueue = this.directoryQueue.concat(await this.readDir(filePath));
      }
    } else {
      if (await this.isValidFile(filePath) === false) {
        this.Progress.log('processing: ' + filePath);
        this.Progress.Processed++;
        await fsp.unlink(filePath);
      } else {
        this.Progress.log('skipping: ' + filePath);
        this.Progress.Skipped++;
      }

    }
    return true;
  }

  protected async step(): Promise<boolean> {
    if (this.directoryQueue.length === 0) {
      return false;
    }
    if (this.tempRootCleaned === false) {
      this.tempRootCleaned = true;
      return this.stepTempDirectory();
    }
    return this.stepConvertedDirectory();
  }

}
