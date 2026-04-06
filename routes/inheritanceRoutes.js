const express = require('express');
const router = express.Router();
const User = require('../models/users');
const FamilyMember = require('../models/FamilyMember');
const Contract = require('../models/Contract');
const Will = require('../models/Will');
const { authenticateToken } = require('../middleware/auth');
const InheritanceExecution = require('../models/InheritanceExecution');

router.post('/execute/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const deceased = await User.findById(userId);
        if (!deceased) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (deceased.isALive) {
            return res.status(400).json({ success: false, message: 'User is still alive' });
        }
        
        const will = await Will.findOne({ userId, status: 'active' });
        if (!will) {
            return res.status(404).json({ success: false, message: 'No active will found' });
        }
        
        if (!will.selectedProperties || will.selectedProperties.length === 0) {
            return res.status(400).json({ success: false, message: 'No properties in will' });
        }
        
        const executionHeirs = [];
        
        for (const heir of will.heirs) {
            let heirUser = await User.findOne({ nationalId: heir.nationalId });
            
            if (!heirUser) {
                const hashedPassword = await bcrypt.hash(heir.nationalId, 10);
                heirUser = new User({
                    fullName: heir.fullName,
                    password: hashedPassword,
                    phoneNumber: null,
                    nationalId: heir.nationalId,
                    gender: 'male',
                    isTempUser: true,
                    isAlive: true,
                    isActive: true
                });
                await heirUser.save();
            }
            
            const transferredProperties = [];
            
            for (const property of will.selectedProperties) {
                const originalContract = await Contract.findById(property.contractId);
                if (!originalContract) continue;
                
                const heirSharePercentage = originalContract.ownershipPercentage * heir.share;
                
                const newContract = new Contract({
                    userId: heirUser._id,
                    contractNumber: `INH-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    fullName: heir.fullName,
                    nationalId: heir.nationalId,
                    phoneNumber: heirUser.phoneNumber || '',
                    propertyNumber: originalContract.propertyNumber,
                    ownershipPercentage: heirSharePercentage,
                    address: originalContract.address,
                    governorate: originalContract.governorate,
                    propertyType: originalContract.propertyType,
                    propertyCategory: originalContract.propertyCategory,
                    floor: originalContract.floor,
                    price: originalContract.price * heir.share,
                    area: originalContract.area,
                    status: 'completed',
                    contractImage: originalContract.contractImage
                });
                
                await newContract.save();
                
                transferredProperties.push({
                    contractId: newContract._id,
                    propertyNumber: originalContract.propertyNumber,
                    percentage: heirSharePercentage
                });
            }
            
            executionHeirs.push({
                familyMemberId: null, 
                nationalId: heir.nationalId,
                fullName: heir.fullName,
                relationType: heir.relationType,
                share: heir.share,
                transferredProperties
            });
        }
        
        const execution = new InheritanceExecution({
            deceasedId: userId,
            willId: will._id,
            heirs: executionHeirs,
            status: 'completed'
        });
        
        await execution.save();
        
        will.status = 'executed';
        will.executedAt = Date.now();
        await will.save();

        res.json({
            success: true,
            message: 'Inheritance executed successfully',
            execution
        });
        
    } catch (error) {
        console.error('Error executing inheritance:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
router.get('/family-tree/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
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
            }
        });

        res.json({ success: true, tree });
    } catch (error) {
        console.error('Error building family tree:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Calculate inheritance
router.post('/calculate', authenticateToken, async (req, res) => {
    try {
        const { deceasedId } = req.body;
        
        const deceased = await User.findById(deceasedId);
        if (!deceased) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const familyMembers = await FamilyMember.find({ 
            userId: deceasedId,
            isAlive: true 
        });
        
        const shares = [];
        let remaining = 1;
        
        const hasSon = familyMembers.some(m => m.relationType === 'son' && m.isAlive);
        const daughters = familyMembers.filter(m => m.relationType === 'daughter' && m.isAlive);
        const hasWife = familyMembers.some(m => m.relationType === 'wife' && m.isAlive);
        const hasHusband = familyMembers.some(m => m.relationType === 'husband' && m.isAlive);
        
        if (hasWife) {
            const wife = familyMembers.find(m => m.relationType === 'wife');
            const wifeShare = (hasSon || daughters.length > 0) ? 1/8 : 1/4;
            shares.push({
                name: wife.fullName,
                relation: 'wife',
                share: wifeShare,
                nationalId: wife.nationalId
            });
            remaining -= wifeShare;
        }
        
        if (hasHusband) {
            const husband = familyMembers.find(m => m.relationType === 'husband');
            const husbandShare = (hasSon || daughters.length > 0) ? 1/4 : 1/2;
            shares.push({
                name: husband.fullName,
                relation: 'husband',
                share: husbandShare,
                nationalId: husband.nationalId
            });
            remaining -= husbandShare;
        }
        
        if (hasSon) {
            const sons = familyMembers.filter(m => m.relationType === 'son' && m.isAlive);
            if (daughters.length > 0) {
                const totalShares = (sons.length * 2) + daughters.length;
                const sharePerUnit = remaining / totalShares;
                
                sons.forEach(son => {
                    shares.push({
                        name: son.fullName,
                        relation: 'son',
                        share: sharePerUnit * 2,
                        nationalId: son.nationalId
                    });
                });
                
                daughters.forEach(daughter => {
                    shares.push({
                        name: daughter.fullName,
                        relation: 'daughter',
                        share: sharePerUnit,
                        nationalId: daughter.nationalId
                    });
                });
            } else {
                const sonShare = remaining / sons.length;
                sons.forEach(son => {
                    shares.push({
                        name: son.fullName,
                        relation: 'son',
                        share: sonShare,
                        nationalId: son.nationalId
                    });
                });
            }
        } else if (daughters.length > 0) {
            const daughtersShare = daughters.length === 1 ? 1/2 : 2/3;
            const sharePerDaughter = daughtersShare / daughters.length;
            daughters.forEach(daughter => {
                shares.push({
                    name: daughter.fullName,
                    relation: 'daughter',
                    share: sharePerDaughter,
                    nationalId: daughter.nationalId
                });
            });
        }
        
        res.json({ 
            success: true, 
            shares,
            total: shares.reduce((sum, s) => sum + s.share, 0)
        });
    } catch (error) {
        console.error('Error calculating inheritance:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Save will
router.post('/will', authenticateToken, async (req, res) => {
    try {

        const { religion, distributionMethod, selectedProperties, heirs, notes } = req.body;

        console.log('📦 Received will data:', JSON.stringify(req.body, null, 2));

        if (!religion) {
            return res.status(400).json({
                success: false,
                message: 'Religion is required'
            });
        }

        if (!distributionMethod) {
            return res.status(400).json({
                success: false,
                message: 'Distribution method is required'
            });
        }

        if (!Array.isArray(heirs)) {
            return res.status(400).json({
                success: false,
                message: 'Heirs must be an array'
            });
        }

        if (!Array.isArray(selectedProperties)) {
            return res.status(400).json({
                success: false,
                message: 'Selected properties must be an array'
            });
        }

        let processedHeirs = heirs;

        if (!heirs.some(h => h.share && h.share > 0)) {

            const familyMembers = await FamilyMember.find({
                userId: req.user.id,
                isAlive: true
            });

            const shares = [];
            let remaining = 1;

            const hasSon = familyMembers.some(m => m.relationType === 'son');
            const daughters = familyMembers.filter(m => m.relationType === 'daughter');
            const hasWife = familyMembers.some(m => m.relationType === 'wife');

            if (hasWife) {

                const wife = familyMembers.find(m => m.relationType === 'wife');
                const wifeShare = (hasSon || daughters.length > 0) ? 1 / 8 : 1 / 4;

                shares.push({
                    fullName: wife.fullName,
                    nationalId: wife.nationalId,
                    relationType: 'wife',
                    share: wifeShare
                });

                remaining -= wifeShare;
            }

            if (hasSon) {

                const sons = familyMembers.filter(m => m.relationType === 'son');

                const totalShares = (sons.length * 2) + daughters.length;
                const unit = remaining / totalShares;

                sons.forEach(s => {
                    shares.push({
                        fullName: s.fullName,
                        nationalId: s.nationalId,
                        relationType: 'son',
                        share: unit * 2
                    });
                });

                daughters.forEach(d => {
                    shares.push({
                        fullName: d.fullName,
                        nationalId: d.nationalId,
                        relationType: 'daughter',
                        share: unit
                    });
                });

            }

            processedHeirs = shares;
        }


        const willData = {
            userId: req.user.id,
            religion,
            distributionMethod,
            selectedProperties,
            heirs: processedHeirs,
            notes: notes || '',
            status: 'active'
        };

        console.log('📝 Will data to save:', JSON.stringify(willData, null, 2));

        const will = new Will(willData);
        await will.save();

        console.log('✅ Will saved successfully with ID:', will._id);

        res.json({
            success: true,
            message: 'Will saved successfully',
            will
        });

    } catch (error) {

        console.error('❌ Error saving will:', error);

        res.status(500).json({
            success: false,
            message: error.message || 'Server error'
        });

    }
});

router.get('/wills', authenticateToken, async (req, res) => {
    try {
        const wills = await Will.find({ userId: req.user.id })
            .populate({
                path: 'selectedProperties.contractId',
                select: 'propertyType area governorate address contractNumber ownershipPercentage'
            })
            .sort('-createdAt');
        
        const formattedWills = wills.map(will => {
            const totalShares = will.heirs.reduce((sum, heir) => sum + (heir.share || 0), 0);
            
            return {
                ...will.toObject(),
                summary: {
                    totalHeirs: will.heirs.length,
                    totalProperties: will.selectedProperties.length,
                    totalShares: totalShares,
                    isComplete: Math.abs(totalShares - 1) < 0.01
                },
                heirs: will.heirs.map(heir => ({
                    ...heir,
                    sharePercentage: (heir.share * 100).toFixed(2) + '%',
                    shareDisplay: `${(heir.share * 100).toFixed(2)}%`
                })),
                selectedProperties: will.selectedProperties.map(prop => ({
                    ...prop,
                    propertyDisplay: prop.contractId ? 
                        `${prop.contractId.propertyType} - ${prop.contractId.area} م²` : 
                        'عقار غير معروف'
                }))
            };
        });
        
        res.json({ 
            success: true, 
            wills: formattedWills 
        });
    } catch (error) {
        console.error('Error fetching wills:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/will/:willId', authenticateToken, async (req, res) => {
    try {
        const will = await Will.findOne({
            _id: req.params.willId,
            userId: req.user.id
        }).populate({
            path: 'selectedProperties.contractId',
            select: 'propertyType area governorate address contractNumber ownershipPercentage formattedPrice formattedArea'
        });
        
        if (!will) {
            return res.status(404).json({ success: false, message: 'Will not found' });
        }
        
        const formattedWill = {
            ...will.toObject(),
            summary: {
                createdDate: will.createdAt.toLocaleDateString('ar-EG'),
                status: will.status === 'active' ? 'نشطة' : 
                        will.status === 'executed' ? 'منفذة' : 'ملغية',
                totalHeirs: will.heirs.length,
                totalProperties: will.selectedProperties.length,
                totalShares: will.heirs.reduce((sum, h) => sum + h.share, 0)
            },
            heirs: will.heirs.map(heir => ({
                ...heir,
                relationArabic: heir.relationType === 'father' ? 'أب' :
                               heir.relationType === 'mother' ? 'أم' :
                               heir.relationType === 'wife' ? 'زوجة' :
                               heir.relationType === 'husband' ? 'زوج' :
                               heir.relationType === 'son' ? 'ابن' :
                               heir.relationType === 'daughter' ? 'ابنة' :
                               heir.relationType === 'brother' ? 'أخ' :
                               heir.relationType === 'sister' ? 'أخت' : 'آخر',
                sharePercentage: (heir.share * 100).toFixed(2),
                shareDisplay: `${(heir.share * 100).toFixed(2)}%`
            })),
            selectedProperties: will.selectedProperties.map(prop => ({
                ...prop,
                propertyDetails: prop.contractId ? {
                    type: prop.contractId.propertyType,
                    area: prop.contractId.area,
                    location: `${prop.contractId.governorate} - ${prop.contractId.address}`,
                    ownershipPercentage: prop.ownershipPercentage,
                    formattedPrice: prop.contractId.formattedPrice,
                    formattedArea: prop.contractId.formattedArea
                } : null
            }))
        };
        
        res.json({ 
            success: true, 
            will: formattedWill 
        });
    } catch (error) {
        console.error('Error fetching will:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;