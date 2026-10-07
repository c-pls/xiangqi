const { z } = require('zod');

// Client -> Server schemas
const HelloSchema = z.object({
    type: z.literal('hello'),
    username: z.string().trim().min(2, 'Username must be at least 2 characters').max(20, 'Username must be at most 20 characters'),
    sessionToken: z.string().optional()
});

const CreateRoomSchema = z.object({
    type: z.literal('createRoom'),
    name: z.string().trim().max(30).optional(),
    side: z.enum(['red', 'black', 'random']).default('random'),
    timeMode: z.enum(['unlimited', '3min', '5min', '10min']).default('unlimited')
});

const JoinRoomSchema = z.object({
    type: z.literal('joinRoom'),
    code: z.string().trim().min(4).max(10)
});

const LeaveRoomSchema = z.object({
    type: z.literal('leaveRoom')
});

const ListRoomsSchema = z.object({
    type: z.literal('listRooms')
});

const PositionSchema = z.union([
    z.object({
        r: z.number().int().min(0).max(9),
        c: z.number().int().min(0).max(8)
    }),
    z.tuple([
        z.number().int().min(0).max(9),
        z.number().int().min(0).max(8)
    ]).transform(([r, c]) => ({ r, c }))
]);

const MoveSchema = z.object({
    type: z.literal('move'),
    roomId: z.string().optional(),
    from: PositionSchema,
    to: PositionSchema
});

const ResignSchema = z.object({
    type: z.literal('resign')
});

const OfferDrawSchema = z.object({
    type: z.literal('offerDraw')
});

const RespondDrawSchema = z.object({
    type: z.literal('respondDraw'),
    accept: z.boolean()
});

const RematchSchema = z.object({
    type: z.literal('rematch')
});

const ChatSchema = z.object({
    type: z.literal('chat'),
    text: z.string().trim().min(1).max(140)
});

const PingSchema = z.object({
    type: z.literal('ping')
});

const ClientMessageSchema = z.discriminatedUnion('type', [
    HelloSchema,
    CreateRoomSchema,
    JoinRoomSchema,
    LeaveRoomSchema,
    ListRoomsSchema,
    MoveSchema,
    ResignSchema,
    OfferDrawSchema,
    RespondDrawSchema,
    RematchSchema,
    ChatSchema,
    PingSchema
]);

module.exports = {
    ClientMessageSchema,
    HelloSchema,
    CreateRoomSchema,
    JoinRoomSchema,
    LeaveRoomSchema,
    ListRoomsSchema,
    MoveSchema,
    ResignSchema,
    OfferDrawSchema,
    RespondDrawSchema,
    RematchSchema,
    ChatSchema,
    PingSchema
};
