import express from 'express'
import SearchController from '../controllers/searchController'

const router = express.Router()

router.get('/', SearchController.searchAll)

router.get('/suggestions', SearchController.getSuggestions)

router.get('/trending', SearchController.getTrending)

router.get('/stats', SearchController.getSearchStats)

router.get('/tracking', SearchController.getFrequentSearches)

router.delete('/history', SearchController.clearSearchHistory)

export default router