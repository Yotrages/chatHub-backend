import express from 'express';
import SearchController from '../controllers/searchController';
import { authenticateToken } from '../middleware/authMiddleware'; 

const router = express.Router();

router.get('/', authenticateToken, SearchController.searchAll);

router.get('/suggestions', SearchController.getSuggestions);

router.get('/trending', SearchController.getTrending);

router.get('/stats', authenticateToken, SearchController.getSearchStats);

router.get('/tracking', authenticateToken, SearchController.getFrequentSearches);

router.delete('/history', authenticateToken, SearchController.clearSearchHistory);

router.delete('/history/:searchId', authenticateToken, SearchController.deleteSearchEntry);

export default router;