import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../i18n/app_localizations.dart';
import '../../storage/punch_events_repo.dart';
import '../../models/punch_event.dart';

class PunchScreen extends StatefulWidget {
  const PunchScreen({super.key});

  @override
  State<PunchScreen> createState() => _PunchScreenState();
}

class _PunchScreenState extends State<PunchScreen> {
  final PunchEventsRepo _punchEventsRepo = PunchEventsRepo();

  String _status = 'idle'; // idle, in, done
  DateTime? _punchInTime;
  DateTime? _punchOutTime;
  List<PunchEvent> _todayEvents = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadTodayStatus();
  }

  Future<void> _loadTodayStatus() async {
    setState(() => _isLoading = true);
    try {
      final allEvents = await _punchEventsRepo.getAllEvents();
      final now = DateTime.now();
      final todayEvents = allEvents.where((e) {
        return e.timestamp.year == now.year &&
            e.timestamp.month == now.month &&
            e.timestamp.day == now.day;
      }).toList();

      String status = 'idle';
      DateTime? inTime;
      DateTime? outTime;

      final inEvents = todayEvents.where((e) => e.type == 'in').toList();
      final outEvents = todayEvents.where((e) => e.type == 'out').toList();

      if (inEvents.isNotEmpty) {
        inTime = inEvents.first.timestamp;
        status = 'in';
      }
      if (outEvents.isNotEmpty) {
        outTime = outEvents.first.timestamp;
        status = 'done';
      }

      setState(() {
        _status = status;
        _punchInTime = inTime;
        _punchOutTime = outTime;
        _todayEvents = todayEvents;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
    }
  }

  void _handlePunchIn() {
    if (_status == 'in') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.t('punch.already_in')),
          backgroundColor: const Color(0xFFf59e0b),
        ),
      );
      return;
    }
    if (_status == 'done') {
      final l10n = AppLocalizations.of(context)!;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF1a1a3e),
          title: Text(
            l10n.t('punch.day_complete_title'),
            style: const TextStyle(color: Colors.white),
          ),
          content: Text(
            l10n.t('punch.day_complete_msg'),
            style: const TextStyle(color: Color(0xFF94A3B8)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }
    context.go('/worker/punch/capture?type=in');
  }

  void _handlePunchOut() {
    if (_status == 'idle') {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.t('punch.not_in')),
          backgroundColor: const Color(0xFFEF4444),
        ),
      );
      return;
    }
    if (_status == 'done') return;
    context.go('/worker/punch/capture?type=out');
  }

  void _logout() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1a1a3e),
        title: Text(
          l10n.t('punch.logout_title'),
          style: const TextStyle(color: Colors.white),
        ),
        content: Text(
          l10n.t('punch.logout_msg'),
          style: const TextStyle(color: Color(0xFF94A3B8)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.t('common.cancel')),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.t('settings.logout')),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      context.go('/welcome');
    }
  }

  String _formatTime(DateTime time) {
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  String _getElapsedTime() {
    if (_punchInTime == null) return '--:--';
    final end = _punchOutTime ?? DateTime.now();
    final diff = end.difference(_punchInTime!);
    final h = diff.inHours;
    final m = diff.inMinutes.remainder(60);
    final s = diff.inSeconds.remainder(60);
    // Show seconds for sub-hour spans (parity with Android) so a short
    // in->out gap is visible instead of "0h 0m".
    if (h > 0) return '${h}h ${m.toString().padLeft(2, '0')}m';
    if (m > 0) return '${m}m ${s.toString().padLeft(2, '0')}s';
    return '${s}s';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final now = DateTime.now();
    final timeStr = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';

    return Scaffold(
      backgroundColor: const Color(0xFF0f0f23),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0f0f23),
        elevation: 0,
        title: Text(
          '${l10n.t('punch.hello')}, Worker',
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout, color: Color(0xFF94A3B8)),
            onPressed: _logout,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF3b82f6)))
          : RefreshIndicator(
              onRefresh: _loadTodayStatus,
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  // Current time
                  Center(
                    child: Text(
                      timeStr,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 48,
                        fontWeight: FontWeight.w300,
                        letterSpacing: 2,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Status card
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1a1a3e),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    child: Column(
                      children: [
                        Text(
                          l10n.t('punch.today_status'),
                          style: const TextStyle(
                            color: Color(0xFF94A3B8),
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 8),
                        _buildStatusChip(),
                        if (_punchInTime != null) ...[
                          const SizedBox(height: 12),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              _buildTimeInfo(
                                'IN',
                                _formatTime(_punchInTime!),
                                const Color(0xFF10B981),
                              ),
                              if (_punchOutTime != null) ...[
                                const SizedBox(width: 24),
                                _buildTimeInfo(
                                  'OUT',
                                  _formatTime(_punchOutTime!),
                                  const Color(0xFFf59e0b),
                                ),
                              ],
                              const SizedBox(width: 24),
                              _buildTimeInfo(
                                _status == 'done'
                                    ? l10n.t('punch.total_hours')
                                    : l10n.t('punch.elapsed'),
                                _getElapsedTime(),
                                const Color(0xFF3b82f6),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),

                  // Punch buttons
                  if (_status == 'done')
                    _buildDoneButton(l10n)
                  else ...[
                    // Punch In button
                    SizedBox(
                      width: double.infinity,
                      height: 72,
                      child: ElevatedButton(
                        onPressed: _status == 'idle' ? _handlePunchIn : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _status == 'idle'
                              ? const Color(0xFF10B981)
                              : const Color(0xFF10B981).withOpacity(0.3),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                          elevation: _status == 'idle' ? 4 : 0,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.login, color: Colors.white, size: 28),
                            const SizedBox(width: 12),
                            Text(
                              l10n.t('punch.punch_in'),
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Punch Out button
                    SizedBox(
                      width: double.infinity,
                      height: 72,
                      child: ElevatedButton(
                        onPressed: _status == 'in' ? _handlePunchOut : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _status == 'in'
                              ? const Color(0xFFf59e0b)
                              : const Color(0xFFf59e0b).withOpacity(0.3),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                          elevation: _status == 'in' ? 4 : 0,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.logout, color: Colors.black, size: 28),
                            const SizedBox(width: 12),
                            Text(
                              l10n.t('punch.punch_out'),
                              style: const TextStyle(
                                color: Colors.black,
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),

                  // Face verify hint
                  Center(
                    child: Text(
                      l10n.t('punch.tap_to_verify'),
                      style: const TextStyle(color: Color(0xFF64748B), fontSize: 13),
                    ),
                  ),
                  const SizedBox(height: 24),

                  // Today's punch history
                  if (_todayEvents.isNotEmpty) ...[
                    const Divider(color: Color(0xFF334155)),
                    const SizedBox(height: 16),
                    Text(
                      'Today\'s Punches',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 12),
                    ..._todayEvents.map(_buildPunchHistoryItem),
                  ],
                  const SizedBox(height: 16),

                  // Calendar link
                  Center(
                    child: TextButton.icon(
                      onPressed: () => context.go('/worker/calendar'),
                      icon: const Icon(Icons.calendar_month, color: Color(0xFF3b82f6)),
                      label: Text(
                        l10n.t('punch.view_calendar'),
                        style: const TextStyle(color: Color(0xFF3b82f6), fontSize: 14),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildStatusChip() {
    final l10n = AppLocalizations.of(context)!;
    Color color;
    String text;
    IconData icon;

    switch (_status) {
      case 'in':
        color = const Color(0xFF10B981);
        text = '${l10n.t('punch.status_in')} ${_punchInTime != null ? _formatTime(_punchInTime!) : ''}';
        icon = Icons.check_circle;
        break;
      case 'done':
        color = const Color(0xFF3b82f6);
        text = l10n.t('punch.status_done');
        icon = Icons.done_all;
        break;
      default:
        color = const Color(0xFF64748B);
        text = l10n.t('punch.status_idle');
        icon = Icons.schedule;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(color: color, fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildTimeInfo(String label, String value, Color color) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Widget _buildDoneButton(AppLocalizations l10n) {
    return Container(
      width: double.infinity,
      height: 72,
      decoration: BoxDecoration(
        color: const Color(0xFF3b82f6).withOpacity(0.15),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF3b82f6).withOpacity(0.3)),
      ),
      child: Center(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.done_all, color: Color(0xFF3b82f6), size: 28),
            const SizedBox(width: 12),
            Text(
              l10n.t('punch.day_complete'),
              style: const TextStyle(
                color: Color(0xFF3b82f6),
                fontSize: 20,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPunchHistoryItem(PunchEvent event) {
    final isIn = event.type == 'in';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1a1a3e),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        children: [
          Icon(
            isIn ? Icons.login : Icons.logout,
            color: isIn ? const Color(0xFF10B981) : const Color(0xFFf59e0b),
            size: 20,
          ),
          const SizedBox(width: 12),
          Text(
            isIn ? 'Punch In' : 'Punch Out',
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
          const Spacer(),
          Text(
            _formatTime(event.timestamp),
            style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
          ),
        ],
      ),
    );
  }
}
