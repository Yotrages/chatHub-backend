import mongoose from "mongoose"

const SearchHistorySchema = new mongoose.Schema({
  query: { type: String, required: true, index: true },
  count: { type: Number, default: 1 },
  lastSearched: { type: Date, default: Date.now },
});

export const SearchHistory = mongoose.model("SearchHistory", SearchHistorySchema);