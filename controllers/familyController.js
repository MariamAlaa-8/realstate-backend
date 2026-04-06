const User = require('../models/users');
const FamilyMember = require('../models/FamilyMember');

const buildFamilyTree = async (userId) => {
    try {
        const user = await User.findById(userId).select('-password');
        const familyMembers = await FamilyMember.find({ userId });

        const tree = {
            user: {
                _id: user._id,
                fullName: user.fullName,
                nationalId: user.nationalId,
                gender: user.gender,
                isAlive: user.isALive
            },
            spouse: [],
            parents: [],
            children: [],
            siblings: []
        };

        familyMembers.forEach(member => {
            const memberData = {
                _id: member._id,
                fullName: member.fullName,
                nationalId: member.nationalId,
                gender: member.gender,
                relationType: member.relationType,
                isAlive: member.isAlive
            };

            switch(member.relationType) {
                case 'wife':
                case 'husband':
                    tree.spouse.push(memberData);
                    break;
                case 'father':
                case 'mother':
                    tree.parents.push(memberData);
                    break;
                case 'son':
                case 'daughter':
                    tree.children.push(memberData);
                    break;
                case 'brother':
                case 'sister':
                    tree.siblings.push(memberData);
                    break;
                case 'uncle':
                    break;
            }
        });

        return tree;
    } catch (error) {
        console.error('Error building family tree:', error);
        throw error;
    }
};

module.exports = { buildFamilyTree };