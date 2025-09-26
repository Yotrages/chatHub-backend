import express from 'express';
import { Request, Response} from 'express'
import MemoryThread from '../Models/MemoryThreads';
import { authenticateToken } from '../middleware/authMiddleware'; 
import { Comment, Post } from '../Models/Post';

const router = express.Router();

const calculateRelevanceScore = (
  threadKeywords: string[],
  searchKeywords: string[],
  lastActivity: Date,
  interactionCount: number
): number => {
  const keywordMatches = searchKeywords.filter(k => 
    threadKeywords.some(tk => tk.includes(k) || k.includes(tk))
  ).length;
  const keywordScore = Math.min(keywordMatches / searchKeywords.length * 0.4, 0.4);

  const daysSinceActivity = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
  const recencyScore = Math.max(0, 0.4 - (daysSinceActivity * 0.01));

  const interactionScore = Math.min(interactionCount * 0.05, 0.2);

  return Math.min(keywordScore + recencyScore + interactionScore, 1);
};

const extractKeywords = (text: string): string[] => {
  const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by']);
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 10);
};

router.get('/memory-threads/:threadId/details', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { threadId } = req.params;

    const memoryThread = await MemoryThread.findById(threadId);
    if (!memoryThread) {
      res.status(404).json({ error: 'Memory thread not found' });
      return;
    }    

    const contextItems = [];

    for (const postId of memoryThread.relatedPosts) {
      try {
        const post = await Post.findById(postId)
          .populate('authorId', 'username avatar')
          .populate('reactions.userId', 'username avatar');
        
        if (post && !post.isDeleted) {
          contextItems.push({
            _id: post._id,
            content: post.content,
            authorId: post.authorId,
            createdAt: post.createdAt,
            type: 'post',
            reactions: post.reactions,
            commentsCount: post.commentsCount,
            shareCount: post.shareCount
          });
        }

        const comments = await Comment.find({
          dynamicId: postId,
          authorId: { $in: memoryThread.participants },
          isDeleted: { $ne: true }
        })
        .populate('authorId', 'username avatar')
        .populate('reactions.userId', 'username avatar')
        .sort({ createdAt: 1 });

        for (const comment of comments) {
          const commentKeywords = extractKeywords(comment.content);
          const hasMatchingKeywords = memoryThread.keywords.some(keyword =>
            commentKeywords.some(ck => ck.includes(keyword) || keyword.includes(ck))
          );

          if (hasMatchingKeywords) {
            contextItems.push({
              _id: comment._id,
              content: comment.content,
              authorId: comment.authorId,
              createdAt: comment.createdAt,
              type: 'comment',
              reactions: comment.reactions,
              parentPostId: postId
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching post ${postId}:`, error);
      }
    }

    contextItems.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    res.json({
      success: true,
      memoryThread,
      contextItems: contextItems.slice(0, 20) 
    });

  } catch (error) {
    console.error('Memory thread details error:', error);
    res.status(500).json({ error: 'Failed to fetch memory thread details' });
  }
});

router.post('/memory-threads', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId, participantId, keywords } = req.body;

    if (!userId || !participantId || !keywords || keywords.length === 0) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    const threads = await MemoryThread.find({
      participants: { $all: [userId, participantId] },
      keywords: { $in: keywords }
    }).sort({ lastActivity: -1 });

    const updatedThreads = threads.map(thread => {
      const score = calculateRelevanceScore(
        thread.keywords,
        keywords,
        thread.lastActivity,
        thread.relatedPosts.length
      );
      return { ...thread.toObject(), relevanceScore: score };
    });

    const relevantThreads = updatedThreads
      .filter(thread => thread.relevanceScore > 0.15)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10);

    res.json(relevantThreads);
  } catch (error) {
    console.error('Memory threads error:', error);
    res.status(500).json({ error: 'Failed to fetch memory threads' });
  }
});

router.post('/memory-threads/process', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId, content, participants, postId } = req.body;
    const keywords = extractKeywords(content);
    
    if (keywords.length === 0 || participants.length !== 2) {
      res.json({ success: true });
      return;
    }

    const existingThread = await MemoryThread.findOne({
      participants: { $all: participants },
      keywords: { $in: keywords }
    });

    if (existingThread) {
      await MemoryThread.findByIdAndUpdate(existingThread._id, {
        $addToSet: { 
          relatedPosts: postId,
          keywords: { $each: keywords }
        },
        lastActivity: new Date()
      });
    } else {
      await MemoryThread.create({
        participants,
        keywords,
        relatedPosts: [postId],
        context: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        lastActivity: new Date(),
        relevanceScore: 0.5
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Content processing error:', error);
    res.status(500).json({ error: 'Failed to process content' });
  }
});

export default router;
