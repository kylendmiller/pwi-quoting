import { supabase } from './supabase';
import { loadCatalog as load } from '../../src/engine/catalogLoader';
export const loadCatalog = (settings: any) => load(supabase, settings);
