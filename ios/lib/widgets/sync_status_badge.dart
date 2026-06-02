import 'package:flutter/material.dart';

enum SyncStatus { online, offline, pending }

class SyncStatusBadge extends StatelessWidget {
  final SyncStatus status;
  final int pendingCount;
  final String? lastRefresh;

  const SyncStatusBadge({
    super.key,
    required this.status,
    this.pendingCount = 0,
    this.lastRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final Color color;
    final String label;
    final IconData icon;

    switch (status) {
      case SyncStatus.online:
        color = const Color(0xFF10B981);
        label = 'Online & syncing';
        icon = Icons.check_circle;
      case SyncStatus.offline:
        color = const Color(0xFFEF4444);
        label = 'Offline';
        icon = Icons.cloud_off;
      case SyncStatus.pending:
        color = const Color(0xFFF59E0B);
        label = '$pendingCount pending';
        icon = Icons.sync;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('System Status', style: TextStyle(color: Colors.white70, fontSize: 12)),
          const SizedBox(height: 4),
          Row(
            children: [
              Icon(icon, color: color, size: 16),
              const SizedBox(width: 6),
              Text(label, style: TextStyle(color: color, fontSize: 14, fontWeight: FontWeight.w600)),
            ],
          ),
          if (lastRefresh != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text('Last refresh: $lastRefresh', style: const TextStyle(color: Colors.white38, fontSize: 11)),
            ),
        ],
      ),
    );
  }
}
