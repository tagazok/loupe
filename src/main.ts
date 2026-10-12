import { engine } from './core/engine';
import './ui/loupe-app';

// Start the image workers now, while this version's files are guaranteed to be
// available, rather than on first edit (a deploy could replace them meanwhile).
engine.warm();
