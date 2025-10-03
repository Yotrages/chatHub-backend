import mongoose from "mongoose";

const SearchHistorySchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true 
  },
  query: { 
    type: String, 
    required: true,
    trim: true
  },
  count: { 
    type: Number, 
    default: 1 
  },
  lastSearched: { 
    type: Date, 
    default: Date.now 
  },
}, {
  timestamps: true
});

SearchHistorySchema.index({ userId: 1, query: 1 });
SearchHistorySchema.index({ userId: 1, lastSearched: -1 });
SearchHistorySchema.index({ userId: 1, count: -1 });

export const SearchHistory = mongoose.model("SearchHistory", SearchHistorySchema);