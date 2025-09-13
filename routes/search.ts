import express from 'express'
import SearchController from '../controllers/searchController'

const router = express.Router()

// Main search endpoint with pagination and filtering
router.get('/', SearchController.searchAll)

// Get search suggestions for autocomplete
router.get('/suggestions', SearchController.getSuggestions)

// Get trending searches and hashtags
router.get('/trending', SearchController.getTrending)

// Get search statistics (admin/analytics)
router.get('/stats', SearchController.getSearchStats)

// Get frequent searches (existing endpoint)
router.get('/tracking', SearchController.getFrequentSearches)

// Clear search history (admin only)
router.delete('/history', SearchController.clearSearchHistory)

export default router