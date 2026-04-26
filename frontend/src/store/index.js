import { configureStore } from '@reduxjs/toolkit';
import globeReducer from './slices/globeSlice';

export const store = configureStore({
  reducer: {
    globe: globeReducer,
  },
});
