import express from 'express'
import SearchController from '../controllers/searchController'

const router = express.Router()

router.get('/tracking', SearchController.getFrequentSearches)
router.get('/' ,SearchController.searchAll)

export default router