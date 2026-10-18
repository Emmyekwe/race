import mongoose from 'mongoose'

const RaceRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    trackName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    lapTimeMs: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'lapTimeMs must be an integer number of milliseconds',
      },
    },
    // Snapshot of the car's colour when the lap was set (garages change; records don't).
    carColor: {
      type: String,
      match: /^#[0-9a-f]{6}$/,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  { versionKey: false },
)

// Leaderboard scan: fastest laps per track.
RaceRecordSchema.index({ trackName: 1, lapTimeMs: 1 })
// Personal-best lookups and per-user history.
RaceRecordSchema.index({ userId: 1, trackName: 1, lapTimeMs: 1 })
RaceRecordSchema.index({ userId: 1, trackName: 1, createdAt: -1 })

/** Fastest lap per user on a track, joined with the username. */
RaceRecordSchema.statics.getLeaderboard = function getLeaderboard(trackName, limit = 10) {
  const usersCollection = mongoose.model('User').collection.name
  return this.aggregate([
    { $match: { trackName } },
    { $sort: { lapTimeMs: 1, createdAt: 1 } },
    {
      $group: {
        _id: '$userId',
        lapTimeMs: { $first: '$lapTimeMs' },
        carColor: { $first: '$carColor' },
        createdAt: { $first: '$createdAt' },
      },
    },
    { $sort: { lapTimeMs: 1, createdAt: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: usersCollection,
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        username: '$user.username',
        lapTimeMs: 1,
        carColor: 1,
        createdAt: 1,
      },
    },
  ])
}

export default mongoose.models.RaceRecord || mongoose.model('RaceRecord', RaceRecordSchema)
